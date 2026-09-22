/**
 * WS 协议 v1：server ↔ extension 消息定义与类型守卫。
 *
 * 请求（server → extension）: { v: 1, id: string, tool: string, params: unknown }
 * 响应（extension → server）: { v: 1, id, ok: true, result } | { v: 1, id, ok: false, error }
 * 握手（extension → server）: { v: 1, type: "hello", version, userAgent }
 */

export const PROTOCOL_VERSION = 1 as const

export interface WsRequest {
  readonly v: typeof PROTOCOL_VERSION
  readonly id: string
  readonly tool: string
  readonly params: unknown
}

export interface WsSuccessResponse {
  readonly v: typeof PROTOCOL_VERSION
  readonly id: string
  readonly ok: true
  readonly result: unknown
}

export interface WsErrorResponse {
  readonly v: typeof PROTOCOL_VERSION
  readonly id: string
  readonly ok: false
  readonly error: string
}

export type WsResponse = WsSuccessResponse | WsErrorResponse

export interface WsHello {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'hello'
  readonly version: string
  readonly userAgent: string
}

export type WsExtensionMessage = WsResponse | WsHello

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isWsRequest(value: unknown): value is WsRequest {
  if (!isRecord(value)) return false
  return (
    value['v'] === PROTOCOL_VERSION &&
    typeof value['id'] === 'string' &&
    typeof value['tool'] === 'string' &&
    'params' in value
  )
}

export function isWsHello(value: unknown): value is WsHello {
  if (!isRecord(value)) return false
  return (
    value['v'] === PROTOCOL_VERSION &&
    value['type'] === 'hello' &&
    typeof value['version'] === 'string' &&
    typeof value['userAgent'] === 'string'
  )
}

export function isWsResponse(value: unknown): value is WsResponse {
  if (!isRecord(value)) return false
  if (value['v'] !== PROTOCOL_VERSION || typeof value['id'] !== 'string') return false
  if (value['ok'] === true) return 'result' in value
  if (value['ok'] === false) return typeof value['error'] === 'string'
  return false
}
