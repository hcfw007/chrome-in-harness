/** ref 交互工具：click / hover / type / scroll。ref 三态解析 + CDP 真实输入。 */
import {TOOL_ERROR_CODES} from '@cic/protocol'
import {ensureAttached} from '../lib/cdp'
import {
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

/** CDP 对失效 backendNodeId 的报错统一映射为 STALE_REF 文案，模型可据此自纠。 */
function isStaleNodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No node with given id')
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
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const {backendDOMNodeId} = await resolveRef(target.tabId, ref)
  const {x, y} = await locate(target.tabId, backendDOMNodeId)
  await dispatchClick(target.tabId, x, y)
  return {}
}

export const hover: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
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
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
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
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
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
