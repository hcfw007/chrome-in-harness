import {dispatch} from '../tools'
import {
  PROTOCOL_VERSION,
  isWsRequest,
  type WsErrorResponse,
  type WsHello,
  type WsResponse,
  type WsSuccessResponse,
} from './protocol'

const WS_URL = 'ws://127.0.0.1:8765'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

type PendingRequest = {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

let socket: WebSocket | null = null
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const pending = new Map<string, PendingRequest>()

function nextRequestId(): string {
  return crypto.randomUUID()
}

function backoffDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return
  const delay = backoffDelay(reconnectAttempt)
  reconnectAttempt += 1
  console.log(`[connection] reconnecting in ${delay}ms (attempt ${reconnectAttempt})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function rejectAllPending(reason: string): void {
  for (const {reject, timer} of pending.values()) {
    clearTimeout(timer)
    reject(new Error(reason))
  }
  pending.clear()
}

function sendHello(ws: WebSocket): void {
  const hello: WsHello = {
    v: PROTOCOL_VERSION,
    type: 'hello',
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
  }
  ws.send(JSON.stringify(hello))
}

async function handleServerRequest(ws: WebSocket, id: string, tool: string, params: unknown): Promise<void> {
  const response: WsResponse = await dispatch(tool, params)
    .then((result): WsSuccessResponse => ({v: PROTOCOL_VERSION, id, ok: true, result}))
    .catch((error: unknown): WsErrorResponse => ({
      v: PROTOCOL_VERSION,
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response))
  }
}

function onMessage(event: MessageEvent): void {
  const data: unknown = event.data
  if (typeof data !== 'string') return
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    console.warn('[connection] dropping non-JSON message')
    return
  }
  if (!isWsRequest(parsed)) {
    console.warn('[connection] dropping unrecognized message')
    return
  }
  const ws = event.target
  if (!(ws instanceof WebSocket) || ws.readyState !== WebSocket.OPEN) return
  void handleServerRequest(ws, parsed.id, parsed.tool, parsed.params)
}

function bind(ws: WebSocket): void {
  ws.onopen = () => {
    reconnectAttempt = 0
    console.log('[connection] connected to server')
    sendHello(ws)
  }
  ws.onmessage = onMessage
  ws.onclose = () => {
    if (socket === ws) socket = null
    rejectAllPending('WebSocket connection closed before a response arrived')
    scheduleReconnect()
  }
  ws.onerror = () => {
    console.warn('[connection] websocket error')
    ws.close()
  }
}

/** 幂等连接：已连接/连接中则跳过；断开时走指数退避重连（1s 起步、10s 封顶）。 */
export function connect(): void {
  if (socket !== null && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    return
  }
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  try {
    socket = new WebSocket(WS_URL)
  } catch (error) {
    console.warn(`[connection] failed to open socket: ${error instanceof Error ? error.message : error}`)
    socket = null
    scheduleReconnect()
    return
  }
  bind(socket)
}

/** 通过 WS 调用 server 转发下来的工具；未连接或 30s 超时则 reject。 */
export function sendRequest(tool: string, params: unknown): Promise<unknown> {
  const ws = socket
  if (ws === null || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`WebSocket not connected (cannot call "${tool}")`))
  }
  return new Promise<unknown>((resolve, reject) => {
    const id = nextRequestId()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Tool "${tool}" timed out after 30s`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, {resolve, reject, timer})
    ws.send(JSON.stringify({v: PROTOCOL_VERSION, id, tool, params}))
  })
}
