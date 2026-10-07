/** snapshot / navigate 工具实现。takeSnapshot 为 ref 自动恢复共用。 */
import {applyRefToken, renderAxSnapshot} from '../lib/ax-snapshot'
import type {RefSeed} from '../lib/ax-snapshot'
import {ensureAttached} from '../lib/cdp'
import {
  evaluateJson,
  getDocumentRoot,
  getFullAxTree,
  getTabTitle,
  navigateAndWait,
} from '../lib/cdp-commands'
import type {NavigateWaitUntil} from '../lib/cdp-commands'
import {refStore} from '../lib/ref-store'
import {saveVersionFloor, versionFloor} from '../lib/snapshot-version'
import {
  buildWeakScanScript,
  flattenDomElements,
  mapWeakCandidates,
  parseWeakScanResult,
} from '../lib/weak-interactive'
import {snapshotToken} from '../lib/worker-era'
import {authorizeNavigate, authorizeTab, resolveTargetTab} from './access'

import type {ToolHandler} from './types'

export interface TakeSnapshotOptions {
  readonly query?: RegExp
  readonly rootRefBackendNodeId?: number
  readonly maxChars?: number
  readonly withWeakScan?: boolean
}

export interface SnapshotState {
  readonly text: string
  readonly version: number
  readonly token: string
  readonly url: string
  readonly truncated: boolean
  readonly refs: readonly RefSeed[]
}

/**
 * 取一次 a11y 快照：渲染、追加快照 token（worker 代 + 版本）、落 refStore、更新水位线。
 * token 让跨 SW 重启/跨快照的旧 ref 显式失效，杜绝静默错点。
 * snapshot 工具与恢复层共用这一条路径，保证 ref 编号/token 全局一致。
 */
export async function takeSnapshot(tabId: number, url: string, options: TakeSnapshotOptions = {}): Promise<SnapshotState> {
  const nodes = await getFullAxTree(tabId)
  let weakCandidates: ReadonlyMap<number, {tag: string; text: string}> | undefined
  if (options.withWeakScan === true) {
    weakCandidates = await scanWeakCandidates(tabId)
  }
  const render = renderAxSnapshot(nodes, {
    query: options.query,
    rootBackendNodeId: options.rootRefBackendNodeId,
    maxChars: options.maxChars,
    weakCandidates,
  })
  // 先定版本（严格大于任何已用版本，导航/重启都不复用），token 编码进每个 ref
  const version = refStore.nextVersion(tabId, await versionFloor(tabId))
  const token = snapshotToken(version)
  const tokened = applyRefToken(render, token)
  refStore.store(tabId, url, token, tokened.refs, version)
  await saveVersionFloor(tabId, version)
  return {text: tokened.text, version, token, url, truncated: tokened.truncated, refs: tokened.refs}
}

/** 弱交互候选扫描（cursor:pointer/onclick 的 div/li/span）；任何失败都降级为空。 */
async function scanWeakCandidates(tabId: number): Promise<ReadonlyMap<number, {tag: string; text: string}>> {
  try {
    const [candidatesRaw, domRoot] = await Promise.all([
      evaluateJson<unknown>(tabId, buildWeakScanScript()),
      getDocumentRoot(tabId),
    ])
    const elements = flattenDomElements(domRoot)
    return mapWeakCandidates(elements, parseWeakScanResult(candidatesRaw))
  } catch (error) {
    console.warn('[snapshot] weak scan failed:', error instanceof Error ? error.message : error)
    return new Map()
  }
}

export const snapshot: ToolHandler = async (params) => {
  const raw = params as {tabId?: number; query?: string; rootRef?: string; limit?: number}
  const target = await authorizeTab(raw.tabId)
  await ensureAttached(target.tabId)

  let query: RegExp | undefined
  if (raw.query !== undefined) {
    try {
      query = new RegExp(raw.query, 'i')
    } catch {
      throw new Error(`invalid query regex: ${raw.query}`)
    }
  }

  let rootBackendNodeId: number | undefined
  if (raw.rootRef !== undefined) {
    // rootRef 与其他 ref 同一套 token 校验：跨代/过期显式报错，不按编号盲匹配
    const resolved = refStore.resolve(target.tabId, raw.rootRef)
    if (resolved.kind !== 'ok') {
      throw new Error(
        `rootRef ${raw.rootRef} is not usable (${resolved.kind === 'no_snapshot' ? 'no snapshot in this worker era' : 'stale'}); call snapshot first`,
      )
    }
    rootBackendNodeId = resolved.entry.backendDOMNodeId
  }

  const state = await takeSnapshot(target.tabId, target.url, {
    query,
    rootRefBackendNodeId: rootBackendNodeId,
    maxChars: raw.limit,
    withWeakScan: true,
  })
  return {
    snapshot: state.text.length > 0 ? state.text : '(no nodes matched the query)',
    version: state.version,
    url: target.url,
    truncated: state.truncated,
  }
}

/** navigate 只校验目标 URL（起点 tab 常是 about:blank，当前 URL 不在名单是正常的）。 */
export const navigate: ToolHandler = async (params) => {
  const raw = params as {url: string; tabId?: number; waitUntil?: NavigateWaitUntil}
  const waitUntil = raw.waitUntil ?? 'domcontentloaded'
  await authorizeNavigate(raw.url)
  const target = await resolveTargetTab(raw.tabId)
  await ensureAttached(target.tabId)
  refStore.invalidate(target.tabId)
  const {loaded} = await navigateAndWait(target.tabId, raw.url, waitUntil)
  const title = await getTabTitle(target.tabId)
  return {url: raw.url, title, loaded, waitUntil}
}
