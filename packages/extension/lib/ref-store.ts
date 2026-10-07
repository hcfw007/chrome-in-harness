/**
 * ref → 元素映射的内存仓库（纯逻辑，零 chrome.* 依赖）。
 * 按 tabId 分组；每次 snapshot 覆盖并自增版本；导航/detach/关 tab 时整表失效。
 * SW 被杀 → 实例随内存消失，resolve 返回 no_snapshot，文案引导重新 snapshot。
 */

export interface RefEntry {
  readonly ref: string
  readonly backendDOMNodeId: number
  readonly role: string
  readonly name: string
  readonly frameId?: string | undefined
}

export type ResolveResult =
  | {kind: 'ok'; entry: RefEntry}
  | {kind: 'no_snapshot'}
  | {kind: 'stale_ref'}

interface TabSnapshot {
  readonly version: number
  readonly url: string
  readonly refs: ReadonlyMap<string, RefEntry>
}

export class RefStore {
  private readonly tabs = new Map<number, TabSnapshot>()
  /** 上一代快照（每 tab 一层历史）：STALE_REF 建议用它还原失效元素的 role/name。 */
  private readonly previous = new Map<number, TabSnapshot>()

  /**
   * 存入一次快照的全部 ref，返回新版本号（每 tab 独立自增）。
   * minVersion 为版本下限（来自跨 SW 重启的持久化水位线），保证版本号
   * 在 SW 重启后仍单调递增，不回退到 1。
   */
  store(tabId: number, url: string, refs: readonly RefEntry[], minVersion = 0): number {
    const current = this.tabs.get(tabId)
    const version = Math.max((current?.version ?? 0) + 1, minVersion)
    const map = new Map<string, RefEntry>()
    for (const entry of refs) map.set(entry.ref, entry)
    if (current !== undefined) this.previous.set(tabId, current)
    this.tabs.set(tabId, {version, url, refs: map})
    return version
  }

  resolve(tabId: number, ref: string): ResolveResult {
    const snapshot = this.tabs.get(tabId)
    if (snapshot === undefined) return {kind: 'no_snapshot'}
    const entry = snapshot.refs.get(ref)
    if (entry === undefined) return {kind: 'stale_ref'}
    return {kind: 'ok', entry}
  }

  /** 当前快照的全部 ref 条目（无快照返回空），供 STALE_REF 建议挑选相近元素。 */
  entries(tabId: number): readonly RefEntry[] {
    const snapshot = this.tabs.get(tabId)
    return snapshot !== undefined ? [...snapshot.refs.values()] : []
  }

  /** 当前 tab 快照的版本号；无快照返回 0。 */
  version(tabId: number): number {
    return this.tabs.get(tabId)?.version ?? 0
  }

  /** 在上一代快照（历史层）里找 ref：用于还原失效元素的 role/name。 */
  lookupHistorical(tabId: number, ref: string): {entry: RefEntry; version: number} | undefined {
    const snapshot = this.previous.get(tabId)
    const entry = snapshot?.refs.get(ref)
    if (snapshot === undefined || entry === undefined) return undefined
    return {entry, version: snapshot.version}
  }

  /** 是否存在快照（供工具判断 no_snapshot 与 stale 的文案）。 */
  has(tabId: number): boolean {
    return this.tabs.has(tabId)
  }

  invalidate(tabId: number): void {
    this.tabs.delete(tabId)
    this.previous.delete(tabId)
  }

  clear(): void {
    this.tabs.clear()
    this.previous.clear()
  }
}

/** SW 单例。 */
export const refStore = new RefStore()
