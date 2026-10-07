/**
 * ref 交互的自动恢复层：resolve 失败或 CDP 层节点失效时，
 * 内部重取一次快照并重试当前操作；重试仍失败才报 STALE_REF，
 * 报错带「ref 属于哪个快照版本」与最新快照里的相近 ref 建议。
 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {isStaleNodeError} from '../lib/cdp-errors'
import {refStore} from '../lib/ref-store'
import type {RefEntry} from '../lib/ref-store'
import {formatSuggestions, suggestSimilarRefs} from '../lib/ref-suggest'
import {toolError} from './access'
import {takeSnapshot} from './snapshot'

/**
 * 按 ref 执行一次交互操作：
 * ① 直接用现有映射执行；
 * ② resolve 不中（STALE_REF/NO_SNAPSHOT）或执行中报节点失效 → 重取快照后重试一次；
 * ③ 仍失败 → STALE_REF + 版本信息 + 相近 ref 建议。
 */
export async function withRef<T>(
  tabId: number,
  ref: string,
  operation: (entry: RefEntry) => Promise<T>,
): Promise<T> {
  const attempt = async (refreshed: boolean): Promise<T> => {
    if (refreshed) await refreshSnapshot(tabId)
    const result = refStore.resolve(tabId, ref)
    if (result.kind === 'ok') {
      try {
        return await operation(result.entry)
      } catch (error) {
        if (!refreshed && isStaleNodeError(error)) return attempt(true)
        throw error
      }
    }
    if (!refreshed) return attempt(true)
    throw staleRefError(tabId, ref)
  }
  return attempt(false)
}

/** 重取一次快照刷新 refStore（版本继续单调递增）。 */
async function refreshSnapshot(tabId: number): Promise<void> {
  await ensureAttached(tabId)
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  // 必须带弱交互扫描：与 snapshot 工具同一套 ref 编号，否则恢复后 ref 对不上
  await takeSnapshot(tabId, tab?.url ?? '', {withWeakScan: true})
}

function staleRefError(tabId: number, ref: string): Error {
  const currentVersion = refStore.version(tabId)
  const historical = refStore.lookupHistorical(tabId, ref)
  const lostRole = historical?.entry.role ?? ''
  const lostName = historical?.entry.name ?? ''
  const suggestions = suggestSimilarRefs({role: lostRole, name: lostName}, refStore.entries(tabId))
  const origin =
    historical !== undefined
      ? `ref ${ref} belongs to snapshot version ${historical.version}`
      : `ref ${ref} belongs to a snapshot from before the last service worker restart`
  return toolError(
    TOOL_ERROR_CODES.STALE_REF,
    `${origin}, but the current snapshot is version ${currentVersion} and does not contain it. ` +
      `Call snapshot to get fresh refs.${formatSuggestions(suggestions)}`,
  )
}
