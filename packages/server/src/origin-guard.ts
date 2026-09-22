/**
 * WS 握手鉴权：只接受来自 Chrome 扩展的连接。
 *
 * 浏览器页面发起的 WebSocket 不受 CORS 约束，但 Origin 头由浏览器强制写入且页面无法伪造，
 * 因此校验 Origin 必须是 chrome-extension:// 就能挡住「恶意网页顶掉真扩展并接管 tool call」。
 * 挡不住本机任意进程伪造 Origin —— 那类攻击者通常已能直接读 Chrome profile，不在本层威胁模型内。
 * 想收紧到具体扩展时设置 CIC_EXTENSION_ID。
 */

const EXTENSION_ORIGIN_PREFIX = 'chrome-extension://'

export interface OriginGuardOptions {
  /** 指定后只接受该扩展 ID；留空则接受任意 chrome-extension:// 来源。 */
  readonly allowedExtensionId?: string | undefined
}

export function isAllowedExtensionOrigin(
  origin: string | undefined,
  options: OriginGuardOptions = {},
): boolean {
  if (origin === undefined || !origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return false
  const id = origin.slice(EXTENSION_ORIGIN_PREFIX.length)
  if (id.length === 0 || id.includes('/')) return false
  const allowed = options.allowedExtensionId
  if (allowed !== undefined && allowed.length > 0) return id === allowed
  return true
}
