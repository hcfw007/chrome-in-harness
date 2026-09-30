/** ref 交互工具：click / hover / type / scroll。ref 三态解析 + CDP 真实输入。 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {
  activateTab,
  dispatchClick,
  dispatchHover,
  dispatchWheel,
  elementCenter,
  insertText,
  pressEnter,
  scrollIntoViewIfNeeded,
} from '../lib/cdp-commands'
import {viewportCenter} from '../lib/cdp-commands'
import {refStore} from '../lib/ref-store'
import {authorizeTab, toolError} from './access'

import type {ToolHandler} from './types'

/**
 * 输入类工具的公共前置：解析 tab → 激活为可见 → attach。
 * 后台 tab 上 CDP `Input.*` 会被静默丢弃，必须先把 tab 激活到前台。
 */
async function prepareInputTab(tabId?: number): Promise<{tabId: number; url: string}> {
  const target = await authorizeTab(tabId)
  await activateTab(target.tabId)
  await ensureAttached(target.tabId)
  return target
}

/** CDP 对失效 backendNodeId 的报错统一映射为 STALE_REF 文案，模型可据此自纠。 */
function isStaleNodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // 'No node with given id'：节点已从 DOM 移除但 CDP 仍持有旧 id；
  // 'Node is detached from document' / 'Node with given id does not belong to the document'：
  // 元素被移除或替换（SPA 重渲染常见），同样属于 ref 失效，应引导重新 snapshot。
  return (
    message.includes('No node with given id') ||
    message.includes('Node is detached from document') ||
    message.includes('does not belong to the document')
  )
}

interface ResolvedRef {
  readonly backendDOMNodeId: number
}

async function resolveRef(tabId: number, ref: string): Promise<ResolvedRef> {
  const result = refStore.resolve(tabId, ref)
  if (result.kind === 'no_snapshot') {
    throw toolError(
      TOOL_ERROR_CODES.NO_SNAPSHOT,
      'no snapshot for this tab (the service worker may have restarted). Call snapshot first.',
    )
  }
  if (result.kind === 'stale_ref') {
    throw toolError(
      TOOL_ERROR_CODES.STALE_REF,
      `ref ${ref} is stale (the page changed since the snapshot). Call snapshot again.`,
    )
  }
  return {backendDOMNodeId: result.entry.backendDOMNodeId}
}

/** click 前把元素滚进视野并取中心点；stale 节点错误归一为 STALE_REF。 */
async function locate(tabId: number, backendDOMNodeId: number): Promise<{x: number; y: number}> {
  try {
    await scrollIntoViewIfNeeded(tabId, backendDOMNodeId)
    return await elementCenter(tabId, backendDOMNodeId)
  } catch (error) {
    if (isStaleNodeError(error)) {
      throw toolError(
        TOOL_ERROR_CODES.STALE_REF,
        'the referenced element no longer exists in the page. Call snapshot again.',
      )
    }
    throw error
  }
}

export const click: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await prepareInputTab(tabId)
  const {backendDOMNodeId} = await resolveRef(target.tabId, ref)
  const {x, y} = await locate(target.tabId, backendDOMNodeId)
  await dispatchClick(target.tabId, x, y)
  return {}
}

/**
 * 坐标点击（ref 命中不了时的兜底：iframe / Canvas / 无 ref 的 icon-only 容器）。
 * 坐标是视口 CSS 像素；直接走 CDP Input.*，不做元素解析。
 */
export const clickAt: ToolHandler = async (params) => {
  const {x, y, tabId} = params as {x: number; y: number; tabId?: number}
  const target = await prepareInputTab(tabId)
  await dispatchClick(target.tabId, x, y)
  return {}
}

export const hover: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await prepareInputTab(tabId)
  const {backendDOMNodeId} = await resolveRef(target.tabId, ref)
  const {x, y} = await elementCenterSafe(target.tabId, backendDOMNodeId)
  await dispatchHover(target.tabId, x, y)
  return {}
}

/** hover 不滚动页面，取不到中心（OOPIF 等）时直接透出原始错误。 */
async function elementCenterSafe(tabId: number, backendDOMNodeId: number): Promise<{x: number; y: number}> {
  try {
    return await elementCenter(tabId, backendDOMNodeId)
  } catch (error) {
    if (isStaleNodeError(error)) {
      throw toolError(
        TOOL_ERROR_CODES.STALE_REF,
        'the referenced element no longer exists in the page. Call snapshot again.',
      )
    }
    throw error
  }
}

export const typeText: ToolHandler = async (params) => {
  const {ref, text, submit, tabId} = params as {ref: string; text: string; submit?: boolean; tabId?: number}
  const target = await prepareInputTab(tabId)
  const {backendDOMNodeId} = await resolveRef(target.tabId, ref)
  const {x, y} = await locate(target.tabId, backendDOMNodeId)
  await dispatchClick(target.tabId, x, y)
  await insertText(target.tabId, text)
  if (submit === true) await pressEnter(target.tabId)
  return {}
}

export const scroll: ToolHandler = async (params) => {
  const {direction, amount, ref, tabId} = params as {
    direction: 'up' | 'down' | 'left' | 'right'
    amount?: number
    ref?: string
    tabId?: number
  }
  const target = await prepareInputTab(tabId)
  const distance = amount ?? 600
  const [dx, dy] =
    direction === 'left'
      ? [-distance, 0]
      : direction === 'right'
        ? [distance, 0]
        : direction === 'up'
          ? [0, -distance]
          : [0, distance]
  // 指定 ref：滚到元素处并以它为滚轮原点；否则以视口中心为原点
  if (ref !== undefined) {
    const {backendDOMNodeId} = await resolveRef(target.tabId, ref)
    const point = await locate(target.tabId, backendDOMNodeId)
    await dispatchWheel(target.tabId, point.x, point.y, dx, dy)
    return {}
  }
  const center = await viewportCenter(target.tabId)
  await dispatchWheel(target.tabId, center.x, center.y, dx, dy)
  return {}
}
