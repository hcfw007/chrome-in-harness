/** get_text 工具：按 ref 返回子树 innerText（轻量校验，避免整页快照）。 */

import {ensureAttached} from '../lib/cdp'
import {resolveNodeInnerText} from '../lib/cdp-commands'
import {authorizeTab} from './access'
import {withRef} from './ref-recovery'

import type {ToolHandler} from './types'

/** 返回文本上限：超出截断并打标。 */
export const GET_TEXT_MAX_CHARS = 8_192

export const getText: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const text = await withRef(target.tabId, ref, (entry) =>
    resolveNodeInnerText(target.tabId, entry.backendDOMNodeId),
  )
  if (text.length > GET_TEXT_MAX_CHARS) {
    return {text: text.slice(0, GET_TEXT_MAX_CHARS), truncated: true}
  }
  return {text, truncated: false}
}
