/** snapshot / navigate 工具实现。takeSnapshot 为 ref 自动恢复共用。 */
import {renderAxSnapshot} from '../lib/ax-snapshot'
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
  readonly url: string
  readonly truncated: boolean
  readonly refs: readonly RefSeed[]
}

/**
 * 取一次 a11y 快照：渲染、落 refStore（版本取持久化水位线保证单调）、更新水位线。
 * snapshot 工具与 STALE_REF/NO_SNAPSHOT 自动恢复共用这一条路径。
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
  const floor = await versionFloor(tabId)
  const version = refStore.store(tabId, url, render.refs, floor)
  await saveVersionFloor(tabId, version)
  return {text: render.text, version, url, truncated: render.truncated, refs: render.refs}
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
    const resolved = refStore.resolve(target.tabId, raw.rootRef)
    if (resolved.kind !== 'ok') {
      // rootRef 失效：自动重取一次全量快照刷新 refStore 后再解析
      await takeSnapshot(target.tabId, target.url)
      const retry = refStore.resolve(target.tabId, raw.rootRef)
      if (retry.kind !== 'ok') {
        throw new Error(`rootRef ${raw.rootRef} not found in the current accessibility tree; call snapshot first`)
      }
      rootBackendNodeId = retry.entry.backendDOMNodeId
    } else {
      rootBackendNodeId = resolved.entry.backendDOMNodeId
    }
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
