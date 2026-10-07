/**
 * ref 交互的恢复层。语义（第二轮收紧）：
 * - 同 worker 代内、快照更替导致 ref 过期：按元素身份（历史层的 backendDOMNodeId）
 *   在新快照里找回同一元素并重试一次——SPA 重渲染的安全恢复路径；
 * - 跨 worker 代（SW 重启前的 ref）或无历史可查：一律显式 STALE_REF/NO_SNAPSHOT，
 *   绝不按 ref 编号盲匹配——静默错点比报错更糟。
 * CDP 层节点失效（isStaleNodeError）同走身份恢复。
 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {isStaleNodeError} from '../lib/cdp-errors'
import {refStore} from '../lib/ref-store'
import type {RefEntry} from '../lib/ref-store'
import {formatSuggestions, suggestSimilarRefs} from '../lib/ref-suggest'
import {toolError} from './access'
import {takeSnapshot} from './snapshot'
import type {SnapshotState} from './snapshot'

/**
 * 按 ref 执行一次交互操作（含身份恢复）：
 * ① 用现有映射执行；
 * ② resolve 不中 → 若历史层有该元素的旧映射，重取快照后按 backendDOMNodeId 找回并重试；
 *    否则显式报错（跨代/legacy/无快照各自带原因与建议）；
 * ③ 执行中报 CDP 节点失效 → 同②的恢复路径重试一次。
 */
export async function withRef<T>(
  tabId: number,
  ref: string,
  operation: (entry: RefEntry) => Promise<T>,
): Promise<T> {
  const attempt = async (refreshed: boolean): Promise<T> => {
    const result = refStore.resolve(tabId, ref)
    if (result.kind === 'ok') {
      try {
        return await operation(result.entry)
      } catch (error) {
        if (!refreshed && isStaleNodeError(error)) return attempt(true)
        throw error
      }
    }
    if (refreshed) throw staleRefError(tabId, ref, failed.kind === 'stale_ref' ? failed.reason : undefined)
    return attemptAfterRecovery(tabId, ref, result, operation)
  }
  return attempt(false)
}

/** 首次失败的恢复路径：只有同代内能找到元素旧映射时才安全重试。 */
async function attemptAfterRecovery<T>(
  tabId: number,
  ref: string,
  failed: Exclude<ReturnType<typeof refStore.resolve>, {kind: 'ok'}>,
  operation: (entry: RefEntry) => Promise<T>,
): Promise<T> {
  if (failed.kind === 'stale_ref') {
    const historical = refStore.lookupHistorical(tabId, ref)
    if (historical !== undefined) {
      // 同代快照更替：按元素身份在新快照里找回
      const state = await refreshSnapshot(tabId)
      const found = findSameElement(state, historical.entry)
      if (found !== undefined) {
        try {
          return await operation(found)
        } catch (error) {
          if (isStaleNodeError(error)) {
            // 找回后立刻又失效：页面正在剧烈重渲染，显式报错让调用方重新快照
            throw staleRefError(tabId, ref, 'superseded')
          }
          throw error
        }
      }
    }
  }
  if (failed.kind === 'no_snapshot') {
    throw toolError(
      TOOL_ERROR_CODES.NO_SNAPSHOT,
      'no snapshot for this tab in the current worker era (the service worker may have restarted). ' +
        'Call snapshot first — refs from before a restart are rejected instead of silently reused.',
    )
  }
  throw staleRefError(tabId, ref, failed.kind === 'stale_ref' ? failed.reason : undefined)
}

/** 在新快照里按 backendDOMNodeId 找同一元素。 */
function findSameElement(state: SnapshotState, lost: RefEntry): RefEntry | undefined {
  const match = state.refs.find((r) => r.backendDOMNodeId === lost.backendDOMNodeId)
  if (match === undefined) return undefined
  return {
    ref: match.ref,
    backendDOMNodeId: match.backendDOMNodeId,
    role: match.role,
    name: match.name,
    frameId: match.frameId,
  }
}

async function refreshSnapshot(tabId: number): Promise<SnapshotState> {
  await ensureAttached(tabId)
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  // 与 snapshot 工具同一路径（含弱交互扫描），保证 ref 编号与 token 全局一致
  return takeSnapshot(tabId, tab?.url ?? '', {withWeakScan: true})
}

function staleRefError(tabId: number, ref: string, reason: 'era' | 'superseded' | 'legacy' | undefined): Error {
  const currentVersion = refStore.version(tabId)
  const historical = refStore.lookupHistorical(tabId, ref)
  const lostRole = historical?.entry.role ?? ''
  const lostName = historical?.entry.name ?? ''
  const suggestions = suggestSimilarRefs({role: lostRole, name: lostName}, refStore.entries(tabId))
  const origin =
    reason === 'era'
      ? `ref ${ref} was created before the last service worker restart`
      : reason === 'legacy'
        ? `ref ${ref} is an old-format ref without a snapshot token`
        : `ref ${ref} belongs to an older snapshot than the current version ${currentVersion}`
  return toolError(
    TOOL_ERROR_CODES.STALE_REF,
    `${origin}. ` +
      'Call snapshot to get fresh refs — old refs are rejected instead of silently remapped.' +
      `${formatSuggestions(suggestions)}`,
  )
}
