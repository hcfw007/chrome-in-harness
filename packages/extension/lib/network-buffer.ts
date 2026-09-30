/**
 * per-tab 网络请求环形缓冲（纯逻辑，零 chrome.* 依赖）。
 * 只记录请求元数据（method/url/status/mimeType/error），响应体一律不采集——
 * Network.getResponseBody 会碰到 cookie/token 等敏感面。
 */

export interface NetworkEntry {
  readonly method: string
  readonly url: string
  readonly status: number | undefined
  readonly mimeType: string | undefined
  readonly error: string | undefined
  readonly timestamp: number
}

interface MutableNetworkEntry {
  method: string
  url: string
  status: number | undefined
  mimeType: string | undefined
  error: string | undefined
  timestamp: number
}

export class NetworkBuffer {
  private readonly tabs = new Map<number, Map<string, MutableNetworkEntry>>()

  constructor(private readonly capacity = 500) {}

  private tabEntries(tabId: number): Map<string, MutableNetworkEntry> {
    let entries = this.tabs.get(tabId)
    if (entries === undefined) {
      entries = new Map()
      this.tabs.set(tabId, entries)
    }
    return entries
  }

  /** 请求发出时登记；同一 requestId 的后续事件（响应/失败）就地合并。 */
  recordRequest(tabId: number, requestId: string, method: string, url: string, timestamp: number): void {
    const entries = this.tabEntries(tabId)
    entries.set(requestId, {method, url, status: undefined, mimeType: undefined, error: undefined, timestamp})
    this.trim(tabId)
  }

  recordResponse(tabId: number, requestId: string, status: number, mimeType: string | undefined): void {
    const entry = this.tabEntries(tabId).get(requestId)
    if (entry !== undefined) {
      entry.status = status
      entry.mimeType = mimeType
    }
  }

  recordFailure(tabId: number, requestId: string, errorText: string): void {
    const entry = this.tabEntries(tabId).get(requestId)
    if (entry !== undefined) {
      entry.error = errorText
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

  clear(tabId: number): void {
    this.tabs.delete(tabId)
  }
}

/** SW 单例。 */
export const networkBuffer = new NetworkBuffer()
