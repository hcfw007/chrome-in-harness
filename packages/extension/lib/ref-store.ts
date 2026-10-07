/**
 * ref → 元素映射的内存仓库（纯逻辑，零 chrome.* 依赖）。
 * 按 tabId 分组；每次 snapshot 覆盖并自增版本；导航/detach/关 tab 时整表失效。
 * SW 被杀 → 实例随内存消失，resolve 返回 no_snapshot。
 *
 * ref 带 token（e<N>-<token>，编码 worker 代数 + 快照版本）：
 * - token 与当前快照一致才可解析；
 * - token 不一致 = superseded（快照已更替）；
 * - 无 token = legacy（升级前的旧格式）；
 * 以上全部显式 stale_ref，绝不按编号盲匹配——静默错点比报错更糟。
 */

export interface RefEntry {
  readonly ref: string
  readonly backendDOMNodeId: number
  readonly role: string
  readonly name: string
  readonly frameId?: string | undefined
}

export type StaleReason = 'era' | 'superseded' | 'legacy'

export type ResolveResult =
  | {kind: 'ok'; entry: RefEntry}
  | {kind: 'no_snapshot'}
  | {kind: 'stale_ref'; reason: StaleReason; snapshotVersion?: number}

interface TabSnapshot {
  readonly version: number
  readonly token: string
  readonly url: string
  readonly refs: ReadonlyMap<string, RefEntry>
}

/** 解析 ref 里的 token 后缀：'e3-a7k2' → {num:'e3', token:'a7k2'}；裸 'e3' → token undefined。 */
export function parseRef(ref: string): {num: string; token: string | undefined} {
  const dash = ref.indexOf('-')
  if (dash === -1) return {num: ref, token: undefined}
  return {num: ref.slice(0, dash), token: ref.slice(dash + 1)}
}

/** token 结构：前 4 位 = worker 代（hex），其余 = 快照版本（base36）。 */
export function splitToken(token: string): {gen: string; ver: string} {
  return {gen: token.slice(0, WORKER_GEN_CHARS), ver: token.slice(WORKER_GEN_CHARS)}
}

/** worker 代字符数。 */
export const WORKER_GEN_CHARS = 4

export class RefStore {
  private readonly tabs = new Map<number, TabSnapshot>()
  /** 历史层（每 tab 保留最近 3 层，同 worker 代内）：恢复层用它找回元素的 backendDOMNodeId。
   *  多层的原因：query/rootRef 过滤快照会缩小 ref 集，单层历史容易被它覆盖。 */
  private readonly history = new Map<number, TabSnapshot[]>()
  private static readonly HISTORY_LIMIT = 3

  /**
   * 计算下一次快照版本号：max(内存当前版本, 持久化水位线) + 1。
   * 水位线语义是「本 tab 最近已用版本」——导航 invalidate 清掉内存后，
   * 版本仍严格大于用过的任何一个值（同 token 绝不跨快照复用）。
   */
  nextVersion(tabId: number, lastUsedVersion = 0): number {
    const current = this.tabs.get(tabId)
    return Math.max(current?.version ?? 0, lastUsedVersion) + 1
  }

  /**
   * 存入一次快照的全部 ref（ref 已含 token）。版本号由 nextVersion 预先算出——
   * token 编码版本号，必须先定版本再生成 ref。
   */
  store(tabId: number, url: string, token: string, refs: readonly RefEntry[], version: number): void {
    const current = this.tabs.get(tabId)
    if (current !== undefined) {
      const levels = this.history.get(tabId) ?? []
      levels.push(current)
      while (levels.length > RefStore.HISTORY_LIMIT) levels.shift()
      this.history.set(tabId, levels)
    }
    const map = new Map<string, RefEntry>()
    for (const entry of refs) map.set(entry.ref, entry)
    this.tabs.set(tabId, {version, token, url, refs: map})
  }

  resolve(tabId: number, ref: string): ResolveResult {
    const snapshot = this.tabs.get(tabId)
    if (snapshot === undefined) return {kind: 'no_snapshot'}
    const {token} = parseRef(ref)
    if (token === undefined) return {kind: 'stale_ref', reason: 'legacy', snapshotVersion: snapshot.version}
    if (splitToken(token).gen !== splitToken(snapshot.token).gen) {
      // worker 代不同：这份 ref 诞生于上一次 SW 重启之前
      return {kind: 'stale_ref', reason: 'era', snapshotVersion: snapshot.version}
    }
    if (token !== snapshot.token) {
      return {kind: 'stale_ref', reason: 'superseded', snapshotVersion: snapshot.version}
    }
    const entry = snapshot.refs.get(ref)
    if (entry === undefined) return {kind: 'stale_ref', reason: 'superseded', snapshotVersion: snapshot.version}
    return {kind: 'ok', entry}
  }

  /** 当前 tab 快照的版本号；无快照返回 0。 */
  version(tabId: number): number {
    return this.tabs.get(tabId)?.version ?? 0
  }

  /** 当前快照 token；无快照返回 undefined。 */
  token(tabId: number): string | undefined {
    return this.tabs.get(tabId)?.token
  }

  /** 当前快照的全部 ref 条目（无快照返回空），供 STALE_REF 建议挑选相近元素。 */
  entries(tabId: number): readonly RefEntry[] {
    const snapshot = this.tabs.get(tabId)
    return snapshot !== undefined ? [...snapshot.refs.values()] : []
  }

  /** 在历史层（最近 3 层快照）里找 ref：用于恢复层按元素身份（backendDOMNodeId）重试。 */
  lookupHistorical(tabId: number, ref: string): {entry: RefEntry; version: number} | undefined {
    const levels = this.history.get(tabId) ?? []
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      const snapshot = levels[i]
      const entry = snapshot?.refs.get(ref)
      if (entry !== undefined) return {entry, version: snapshot.version}
    }
    return undefined
  }

  /** 是否存在快照（供工具判断 no_snapshot 与 stale 的文案）。 */
  has(tabId: number): boolean {
    return this.tabs.has(tabId)
  }

  invalidate(tabId: number): void {
    this.tabs.delete(tabId)
    this.history.delete(tabId)
  }

  clear(): void {
    this.tabs.clear()
    this.history.clear()
  }
}

/** SW 单例。 */
export const refStore = new RefStore()
