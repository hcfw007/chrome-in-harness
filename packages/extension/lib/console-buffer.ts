/**
 * per-tab console 环形缓冲（纯逻辑，零 chrome.* 依赖）。
 * 缓冲从该 tab 首次被 attach（Runtime.enable）开始积累，此前的消息不可得。
 */

export type ConsoleLevel = 'error' | 'warning' | 'info'

export interface ConsoleEntry {
  readonly level: ConsoleLevel
  readonly text: string
  readonly timestamp: number
}

export class ConsoleBuffer {
  private readonly tabs = new Map<number, ConsoleEntry[]>()

  constructor(private readonly capacity = 300) {}

  append(tabId: number, entry: ConsoleEntry): void {
    let entries = this.tabs.get(tabId)
    if (entries === undefined) {
      entries = []
      this.tabs.set(tabId, entries)
    }
    entries.push(entry)
    if (entries.length > this.capacity) entries.splice(0, entries.length - this.capacity)
  }

  /** 按时间正序返回；level 过滤（'all' 返回全部）。 */
  read(tabId: number, level: 'error' | 'warning' | 'info' | 'all' = 'all'): readonly ConsoleEntry[] {
    const entries = this.tabs.get(tabId) ?? []
    if (level === 'all') return [...entries]
    return entries.filter((e) => e.level === level)
  }

  clear(tabId: number): void {
    this.tabs.delete(tabId)
  }
}

/** SW 单例。 */
export const consoleBuffer = new ConsoleBuffer()
