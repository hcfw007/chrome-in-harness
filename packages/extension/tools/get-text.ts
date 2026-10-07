/**
 * get_text 工具：按 ref 返回元素文本（8KB 上限，超出截断并标记）。
 * 读取优先级：① 可访问性 value（AX 语义）——虚拟滚动编辑器（Monaco）下唯一可靠；
 * ② DOM innerText（含就近祖先兜底）——按钮/普通容器等无 AX value 的节点。
 */

import {ensureAttached} from '../lib/cdp'
import {getAxNodeValue, getFullAxTree, resolveNodeInnerText} from '../lib/cdp-commands'
import {authorizeTab} from './access'
import {withRef} from './ref-recovery'

import type {ToolHandler} from './types'

/** 返回文本上限：超出截断并打标。 */
export const GET_TEXT_MAX_CHARS = 8_192

function clip(text: string): {text: string; truncated: boolean} {
  if (text.length > GET_TEXT_MAX_CHARS) {
    return {text: text.slice(0, GET_TEXT_MAX_CHARS), truncated: true}
  }
  return {text, truncated: false}
}

export const getText: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  return withRef(target.tabId, ref, async (entry) => {
    // ① AX 语义文本：Monaco 等编辑器的模型全文在这里（.view-lines 只有可见行，DOM 读数不可信）
    let axValue = await getAxNodeValue(target.tabId, entry.backendDOMNodeId)
    if (axValue === undefined || axValue.length === 0) {
      // 部分树可能拿不到 value：回退全树按 backendDOMNodeId 精确查找（与 snapshot 同源）
      const nodes = await getFullAxTree(target.tabId)
      const node = nodes.find((n) => n.backendDOMNodeId === entry.backendDOMNodeId)
      axValue = node?.value
    }
    if (axValue !== undefined && axValue.length > 0) {
      return clip(axValue)
    }
    // ② DOM innerText（祖先兜底）：按钮、菜单项等无 AX value 的节点
    const domText = await resolveNodeInnerText(target.tabId, entry.backendDOMNodeId)
    return clip(domText)
  })
}
