/** ref 交互工具：click / hover / type / press_key / scroll。ref 三态解析 + CDP 真实输入。 */
import {ensureAttached} from '../lib/cdp'
import {
  activateTab,
  dispatchClick,
  dispatchHover,
  dispatchKey,
  dispatchWheel,
  elementCenter,
  focusNode,
  insertText,
  scrollIntoViewIfNeeded,
  viewportCenter,
} from '../lib/cdp-commands'
import type {ClickOptions} from '../lib/cdp-commands'
import {resolveKey} from '../lib/keymap'
import type {InputModifier} from '../lib/keymap'
import {authorizeTab} from './access'
import {withRef} from './ref-recovery'

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

/** click 前把元素滚进视野并取中心点。stale 由 withRef 统一重试，这里不吞错。 */
async function locate(tabId: number, backendDOMNodeId: number): Promise<{x: number; y: number}> {
  await scrollIntoViewIfNeeded(tabId, backendDOMNodeId)
  return elementCenter(tabId, backendDOMNodeId)
}

export const click: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await prepareInputTab(tabId)
  await withRef(target.tabId, ref, async (entry) => {
    const {x, y} = await locate(target.tabId, entry.backendDOMNodeId)
    await dispatchClick(target.tabId, x, y)
  })
  return {}
}

/**
 * 坐标点击（ref 命中不了时的兜底：iframe / Canvas / 无 ref 的 icon-only 容器）。
 * 坐标是视口 CSS 像素；直接走 CDP Input.*，不做元素解析。
 * button 支持右键/中键，clickCount 支持双击，modifiers 支持组合键。
 */
export const clickAt: ToolHandler = async (params) => {
  const {x, y, tabId, button, clickCount, modifiers} = params as {
    x: number
    y: number
    tabId?: number
    button?: 'left' | 'right' | 'middle'
    clickCount?: number
    modifiers?: InputModifier[]
  }
  const target = await prepareInputTab(tabId)
  const options: ClickOptions = {
    ...(button !== undefined ? {button} : {}),
    ...(clickCount !== undefined ? {clickCount} : {}),
    ...(modifiers !== undefined ? {modifiers} : {}),
  }
  await dispatchClick(target.tabId, x, y, options)
  return {}
}

export const hover: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await prepareInputTab(tabId)
  await withRef(target.tabId, ref, async (entry) => {
    const {x, y} = await elementCenter(target.tabId, entry.backendDOMNodeId)
    await dispatchHover(target.tabId, x, y)
  })
  return {}
}

/** 清空当前焦点元素：Ctrl+A 全选 + Delete（Monaco 与原生输入框都认）。 */
async function clearFocused(tabId: number): Promise<void> {
  const selectAll = resolveKey('a')
  if (!selectAll.ok) return
  await dispatchKey(tabId, selectAll.info, ['ctrl'])
  const del = resolveKey('Delete')
  if (!del.ok) return
  await dispatchKey(tabId, del.info, [])
}

export const typeText: ToolHandler = async (params) => {
  const raw = params as {
    ref?: string
    text: string
    submit?: boolean
    mode?: 'insert' | 'verbatim'
    clear?: boolean
    focus?: 'none' | 'click-ref'
    tabId?: number
  }
  const mode = raw.mode ?? 'insert'
  const focus = raw.focus ?? 'click-ref'

  // verbatim 承诺「整段原样插入、零按键事件」：Enter 按键会触发 Monaco 自动缩进，必须拒绝
  if (mode === 'verbatim' && raw.submit === true) {
    throw new Error(
      'submit is not supported with mode="verbatim": pressing Enter would trigger editor auto-indent. ' +
        'Insert the text first, then call press_key(key="Enter") if a newline is wanted.',
    )
  }

  const target = await prepareInputTab(raw.tabId)

  /**
   * verbatim：逐行 insertText + 行间 Enter + Shift+Home+Delete。
   * Chromium 会把多行 insertText 在渲染层拆成逐行 input 事件，换行走 typed-Enter
   * 路径 → Monaco autoIndent 逐行叠加缩进（实测 LeetCode Monaco 同款问题）。
   * 所以换行必须自己处理：Enter（带 '\r' 字符事件才生效）产生自动缩进后，
   * Shift+Home 选中缩进（空白行 smart-Home 直达列 1）再 Delete 抹掉，
   * 下一行的缩进由文本自带，保证逐字符还原。
   */
  const typeVerbatim = async (): Promise<void> => {
    if (raw.clear === true) await clearFocused(target.tabId)
    const lines = raw.text.replace(/\r\n?/g, '\n').split('\n')
    const enter = resolveKey('Enter')
    const home = resolveKey('Home')
    const del = resolveKey('Delete')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      if (line.length > 0) await insertText(target.tabId, line)
      if (i < lines.length - 1 && enter.ok && home.ok && del.ok) {
        await dispatchKey(target.tabId, enter.info, [])
        await dispatchKey(target.tabId, home.info, ['shift'])
        await dispatchKey(target.tabId, del.info, [])
      }
    }
  }

  const typeInsert = async (): Promise<void> => {
    if (raw.clear === true) await clearFocused(target.tabId)
    await insertText(target.tabId, raw.text)
    if (raw.submit === true) {
      const enter = resolveKey('Enter')
      if (enter.ok) await dispatchKey(target.tabId, enter.info, [])
    }
  }

  if (focus === 'none') {
    // 不做隐式点击：光标/选区保持原位（Monaco 行尾追加/插入行中的解法）。
    // 给了 ref 时只做 DOM.focus（不点击），否则直接向当前焦点元素输入。
    if (raw.ref !== undefined) {
      await withRef(target.tabId, raw.ref, async (entry) => {
        await scrollIntoViewIfNeeded(target.tabId, entry.backendDOMNodeId)
        await focusNode(target.tabId, entry.backendDOMNodeId)
      })
    }
    if (mode === 'verbatim') await typeVerbatim()
    else await typeInsert()
    return {}
  }

  if (raw.ref === undefined) {
    throw new Error('ref is required unless focus="none"')
  }
  await withRef(target.tabId, raw.ref, async (entry) => {
    const {x, y} = await locate(target.tabId, entry.backendDOMNodeId)
    await dispatchClick(target.tabId, x, y)
    if (mode === 'verbatim') await typeVerbatim()
    else await typeInsert()
  })
  return {}
}

/** 单键 press：可选先 focus ref 元素；支持 ctrl/alt/shift/meta 组合键。 */
export const pressKey: ToolHandler = async (params) => {
  const raw = params as {
    key: string
    modifiers?: InputModifier[]
    ref?: string
    tabId?: number
  }
  const resolved = resolveKey(raw.key)
  if (!resolved.ok) throw new Error(resolved.error)
  const target = await prepareInputTab(raw.tabId)
  if (raw.ref !== undefined) {
    await withRef(target.tabId, raw.ref, async (entry) => {
      await scrollIntoViewIfNeeded(target.tabId, entry.backendDOMNodeId)
      await focusNode(target.tabId, entry.backendDOMNodeId)
      await dispatchKey(target.tabId, resolved.info, raw.modifiers ?? [])
    })
    return {}
  }
  await dispatchKey(target.tabId, resolved.info, raw.modifiers ?? [])
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
    await withRef(target.tabId, ref, async (entry) => {
      const point = await locate(target.tabId, entry.backendDOMNodeId)
      await dispatchWheel(target.tabId, point.x, point.y, dx, dy)
    })
    return {}
  }
  const center = await viewportCenter(target.tabId)
  await dispatchWheel(target.tabId, center.x, center.y, dx, dy)
  return {}
}
