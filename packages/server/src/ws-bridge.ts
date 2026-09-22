import {PROTOCOL_VERSION, parseExtensionMessage} from '@cic/protocol'
import {WebSocketServer, WebSocket} from 'ws'
import {isAllowedExtensionOrigin, type OriginGuardOptions} from './origin-guard.js'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

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
      return Promise.reject(
        new Error(
          'Chrome extension not connected (is it running and connected to ws://127.0.0.1:8765?)',
        ),
      )
    }
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    return new Promise<unknown>((resolve, reject) => {
      const id = `srv-${++this.nextId}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Extension tool "${tool}" timed out after ${timeoutMs}ms`))
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
        this.rejectAllPending('Extension disconnected before responding')
        console.log('[ws] extension disconnected')
      }
    })
    socket.on('error', (error) => {
      console.error(`[ws] socket error: ${error.message}`)
    })
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
