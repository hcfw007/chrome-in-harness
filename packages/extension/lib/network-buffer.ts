/**
 * per-tab 网络请求环形缓冲（纯逻辑，零 chrome.* 依赖）。
 * 只记录请求元数据（method/url/status/mimeType/error/耗时），响应体与请求头一律不采集——
 * Network.getResponseBody 会碰到 cookie/token 等敏感面（与 Claude in Chrome 同一边界）。
 * data: URL 不记录：内联图片的 base64 动辄数 KB，只会挤占上下文，对排查没有价值。
 */

export interface NetworkEntry {
  readonly method: string
  readonly url: string
  readonly status: number | undefined
  readonly mimeType: string | undefined
  readonly error: string | undefined
  readonly timestamp: number
  /** 发出 → 响应头到达（或失败）的耗时（ms）；未完成为 undefined。 */
  readonly durationMs: number | undefined
  /** 完成时的墙钟时间（SW Date.now()），供 wait_for_response 做回看窗口；未完成为 undefined。 */
  readonly completedAt: number | undefined
}

type MutableNetworkEntry = {-readonly [K in keyof NetworkEntry]: NetworkEntry[K]}

export interface NetworkMatch {
  readonly urlContains: string
  readonly method?: string
  readonly status?: number
  /** 只认完成时间 >= since 的条目。 */
  readonly since: number
}

/** 失败原因细分：取消 / 被拦截（blockedReason）/ CORS / 网络层错误码。 */
export function describeLoadingFailure(params: {
  errorText?: string
  canceled?: boolean
  blockedReason?: string
  corsErrorStatus?: {corsError?: string}
}): string {
  if (params.canceled === true) return 'canceled'
  if (params.blockedReason !== undefined) return `blocked:${params.blockedReason}`
  if (params.corsErrorStatus?.corsError !== undefined) return `cors:${params.corsErrorStatus.corsError}`
  return params.errorText ?? 'failed'
}

/** CDP 时间戳是秒（MonotonicTime）；两端同源才相减，否则不给耗时。 */
function durationBetween(start: number, end: number | undefined): number | undefined {
  if (end === undefined || end < start) return undefined
  return Math.round((end - start) * 1000)
}

export class NetworkBuffer {
  private readonly tabs = new Map<number, Map<string, MutableNetworkEntry>>()

  constructor(
    private readonly capacity = 500,
    private readonly now: () => number = Date.now,
  ) {}

  private tabEntries(tabId: number): Map<string, MutableNetworkEntry> {
    let entries = this.tabs.get(tabId)
    if (entries === undefined) {
      entries = new Map()
      this.tabs.set(tabId, entries)
    }
    return entries
  }

  /** 请求发出时登记；同一 requestId 的后续事件（响应/失败）就地合并。timestamp 为 CDP 秒级时间。 */
  recordRequest(tabId: number, requestId: string, method: string, url: string, timestamp: number): void {
    if (url.startsWith('data:')) return
    const entries = this.tabEntries(tabId)
    entries.set(requestId, {
      method,
      url,
      status: undefined,
      mimeType: undefined,
      error: undefined,
      timestamp,
      durationMs: undefined,
      completedAt: undefined,
    })
    this.trim(tabId)
  }

  recordResponse(tabId: number, requestId: string, status: number, mimeType: string | undefined, timestamp?: number): void {
    const entry = this.tabEntries(tabId).get(requestId)
    if (entry !== undefined) {
      entry.status = status
      entry.mimeType = mimeType
      entry.durationMs = durationBetween(entry.timestamp, timestamp)
      entry.completedAt = this.now()
    }
  }

  recordFailure(tabId: number, requestId: string, errorText: string, timestamp?: number): void {
    const entry = this.tabEntries(tabId).get(requestId)
    if (entry !== undefined) {
      entry.error = errorText
      entry.durationMs = durationBetween(entry.timestamp, timestamp)
      entry.completedAt = this.now()
    }
  }

  private trim(tabId: number): void {
    const entries = this.tabs.get(tabId)
    if (entries === undefined) return
    // Map 迭代序即插入序：超限时删除最旧的
    while (entries.size > this.capacity) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  /** 按时间倒序（最新在前）返回；urlFilter 为 substring 匹配。 */
  read(tabId: number, urlFilter?: string, limit = 50): readonly NetworkEntry[] {
    const entries = this.tabs.get(tabId)
    if (entries === undefined) return []
    const all = [...entries.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((e) => urlFilter === undefined || e.url.includes(urlFilter))
    return all.slice(0, limit)
  }

  /** 最早完成的匹配条目（completedAt >= since）；status 缺省时失败也算完成。 */
  findCompleted(tabId: number, match: NetworkMatch): NetworkEntry | undefined {
    const entries = this.tabs.get(tabId)
    if (entries === undefined) return undefined
    const method = match.method?.toUpperCase()
    let best: NetworkEntry | undefined
    for (const entry of entries.values()) {
      if (entry.completedAt === undefined || entry.completedAt < match.since) continue
      if (!entry.url.includes(match.urlContains)) continue
      if (method !== undefined && entry.method.toUpperCase() !== method) continue
      if (match.status !== undefined && entry.status !== match.status) continue
      if (best === undefined || (best.completedAt ?? 0) > entry.completedAt) best = entry
    }
    return best
  }

  clear(tabId: number): void {
    this.tabs.delete(tabId)
  }
}

/** SW 单例。 */
export const networkBuffer = new NetworkBuffer()
