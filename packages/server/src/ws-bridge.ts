import {PROTOCOL_VERSION, TOOL_ERROR_CODES, parseExtensionMessage} from '@chrome-in-harness/protocol'
import {WebSocketServer, WebSocket} from 'ws'
import {isAllowedExtensionOrigin, type OriginGuardOptions} from './origin-guard.js'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** 断开后这段时间内视为「正在重连」（SW 重启 / reload_extension / 退避首轮 1s），给出等待建议。 */
const RECENT_DISCONNECT_MS = 15_000

/** 工具自带等待（wait / wait_for_response / evaluate_script 的 timeoutMs）之外留给往返与收尾的余量。 */
export const TOOL_WAIT_MARGIN_MS = 5_000

/**
 * 单次调用的桥超时：工具自带 timeoutMs 时至少给到 timeoutMs + 余量。
 * 否则 30s 的等待必然先撞上 30s 的桥超时，模型收到的是误导性的 TOOL_TIMEOUT（「页面卡住」），
 * 而不是工具自己的 {matched:false, timedOut:true}。
 */
export function requestTimeoutFor(params: unknown, baseMs: number): number {
  const requested = requestedWaitMs(params)
  return requested > 0 ? Math.max(baseMs, requested + TOOL_WAIT_MARGIN_MS) : baseMs
}

/** 调用自带的等待时长：普通工具取 timeoutMs；run_actions 累加各步 timeoutMs（步骤串行执行）。 */
function requestedWaitMs(params: unknown): number {
  if (typeof params !== 'object' || params === null) return 0
  const record = params as {timeoutMs?: unknown; actions?: unknown}
  const own = typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0
    ? record.timeoutMs
    : 0
  if (!Array.isArray(record.actions)) return own
  return record.actions.reduce<number>(
    (sum, step) => sum + requestedWaitMs(typeof step === 'object' && step !== null ? (step as {params?: unknown}).params : undefined),
    own,
  )
}

function timeoutMessage(tool: string, timeoutMs: number): string {
  return (
    `${TOOL_ERROR_CODES.TOOL_TIMEOUT}: the extension did not answer "${tool}" within ${timeoutMs}ms — ` +
    'the page may be busy or blocked by a modal (alert/confirm), or DevTools may have taken over the debugger. ' +
    'Check the tab, close DevTools on it, then retry; take a screenshot if unsure what the page is showing.'
  )
}

type PendingRequest = {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

export interface WsBridgeOptions extends OriginGuardOptions {
  /** 传 0 表示由系统分配端口（测试用）；绑定后从 boundPort 读回实际端口。 */
  readonly port: number
  readonly requestTimeoutMs?: number | undefined
}

export class WsBridge {
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private nextId = 0
  /** 最近一次扩展断开的时间；null = 本进程启动后从未断开过（也可能从未连上）。 */
  private lastDisconnectAt: number | null = null

  constructor(private readonly options: WsBridgeOptions) {}

  /** 绑定端口；resolve 时 boundPort 才可读。 */
  start(): Promise<void> {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: this.options.port,
      verifyClient: ({origin}, done) => {
        if (isAllowedExtensionOrigin(origin, this.options)) {
          done(true)
          return
        }
        console.warn(`[ws] rejected connection from origin ${origin ?? '<none>'}`)
        done(false, 403, 'Forbidden origin')
      },
    })
    this.wss = wss
    wss.on('connection', (socket) => this.accept(socket))
    wss.on('error', (error) => {
      console.error(`[ws] server error: ${error.message}`)
    })
    return new Promise<void>((resolve) => {
      wss.once('listening', () => {
        console.log(`[ws] listening on ws://127.0.0.1:${this.boundPort}`)
        resolve()
      })
    })
  }

  close(): void {
    this.rejectAllPending('Server is shutting down')
    this.socket?.close()
    this.socket = null
    this.wss?.close()
    this.wss = null
  }

  /** 实际绑定的端口；未启动时为 null。 */
  get boundPort(): number | null {
    const address = this.wss?.address()
    return typeof address === 'object' && address !== null ? address.port : null
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  sendToExtension(tool: string, params: unknown): Promise<unknown> {
    const socket = this.socket
    if (!this.isConnected || socket === null) {
      return Promise.reject(new Error(this.disconnectedMessage()))
    }
    const timeoutMs = requestTimeoutFor(params, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    return new Promise<unknown>((resolve, reject) => {
      const id = `srv-${++this.nextId}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(timeoutMessage(tool, timeoutMs)))
      }, timeoutMs)
      this.pending.set(id, {resolve, reject, timer})
      socket.send(JSON.stringify({v: PROTOCOL_VERSION, id, tool, params}))
    })
  }

  private accept(socket: WebSocket): void {
    if (this.socket !== null && this.socket !== socket) {
      console.log('[ws] new extension connection, replacing the old one')
      this.socket.close()
    }
    this.socket = socket
    console.log('[ws] extension connected')

    socket.on('message', (data) => this.onMessage(data.toString()))
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.lastDisconnectAt = Date.now()
        this.rejectAllPending(
          `${TOOL_ERROR_CODES.EXTENSION_DISCONNECTED}: the extension disconnected before answering — ` +
            'the call may or may not have taken effect. Snapshot the tab to check its state before retrying.',
        )
        console.log('[ws] extension disconnected')
      }
    })
    socket.on('error', (error) => {
      console.error(`[ws] socket error: ${error.message}`)
    })
  }

  /** 区分「从未连上」与「刚断开、多半在重连」，给出不同的下一步。 */
  private disconnectedMessage(now = Date.now()): string {
    const code = TOOL_ERROR_CODES.EXTENSION_DISCONNECTED
    if (this.lastDisconnectAt !== null && now - this.lastDisconnectAt < RECENT_DISCONNECT_MS) {
      const seconds = Math.max(1, Math.round((now - this.lastDisconnectAt) / 1000))
      return (
        `${code}: the Chrome extension disconnected ${seconds}s ago and is probably reconnecting ` +
        '(service worker restart or reload_extension) — wait a few seconds, then retry. ' +
        'If it keeps failing, check chrome://extensions for load errors.'
      )
    }
    const hint =
      this.lastDisconnectAt === null
        ? 'it has not connected since this server started'
        : `it has been disconnected for ${Math.round((now - this.lastDisconnectAt) / 1000)}s`
    return (
      `${code}: the Chrome extension is not connected (${hint}). ` +
      'Ask the user to make sure Chrome is running and Chrome in Harness is enabled on chrome://extensions; ' +
      `it connects to ws://127.0.0.1:${this.boundPort ?? this.options.port} on its own. Then retry.`
    )
  }

  private rejectAllPending(reason: string): void {
    for (const {reject, timer} of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error(reason))
    }
    this.pending.clear()
  }

  private onMessage(raw: string): void {
    const message = parseExtensionMessage(raw)
    if (message === undefined) {
      console.warn('[ws] dropping malformed message from extension')
      return
    }
    if ('type' in message) {
      console.log(`[ws] extension hello: v${message.version} (${message.userAgent})`)
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined) {
      console.warn(`[ws] no pending request for id ${message.id}`)
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error))
    }
  }
}
