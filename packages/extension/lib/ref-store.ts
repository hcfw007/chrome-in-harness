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

  /** 存入一次快照的全部 ref，返回新版本号（每 tab 独立自增）。 */
  store(tabId: number, url: string, refs: readonly RefEntry[]): number {
    const previous = this.tabs.get(tabId)
    const version = (previous?.version ?? 0) + 1
    const map = new Map<string, RefEntry>()
    for (const entry of refs) map.set(entry.ref, entry)
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

  /** 当前 tab 快照的版本号；无快照返回 0。 */
  version(tabId: number): number {
    return this.tabs.get(tabId)?.version ?? 0
  }

  /** 是否存在快照（供工具判断 no_snapshot 与 stale 的文案）。 */
  has(tabId: number): boolean {
    return this.tabs.has(tabId)
  }

  invalidate(tabId: number): void {
    this.tabs.delete(tabId)
  }

  clear(): void {
    this.tabs.clear()
  }
}

/** SW 单例。 */
export const refStore = new RefStore()
