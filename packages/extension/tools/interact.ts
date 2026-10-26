/** ref 交互工具：click / hover / type / press_key / scroll。ref 三态解析 + CDP 真实输入。 */
import {clickAtParams, scrollToParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {
  clearFocusedNativeValue,
  describeNodeRect,
  dispatchClick,
  dispatchHover,
  dispatchKey,
  dispatchWheel,
  elementCenter,
  ensureFocusEmulation,
  ensureKeyPipelineAlive,
  evaluateJson,
  focusNode,
  getViewportMetrics,
  insertText,
  monacoSetValue,
  readFocusedValue,
  readInputFocus,
  scrollIntoViewIfNeeded,
  viewportCenter,
} from '../lib/cdp-commands'
import type {ClickOptions, CursorPosition, FocusState} from '../lib/cdp-commands'
import {buildHitTestScript, parseHitTestResult} from '../lib/hit-test'
import type {HitInfo} from '../lib/hit-test'
import {resolveKey, selectAllModifier} from '../lib/keymap'
import type {InputModifier} from '../lib/keymap'
import {imagePointToCss, lastScreenshot} from '../lib/screenshot-geometry'
import {buildScrollToScript, CENTER_AND_DESCRIBE, parseScrollToReceipt} from '../lib/scroll-locate'
import {planVerbatim} from '../lib/verbatim'
import {authorizeTab} from './access'
import {parseToolParams} from './params'
import {withRef} from './ref-recovery'
import {snapshot} from './snapshot'

import type {ToolHandler} from './types'

/**
 * 输入类工具的公共前置：解析 tab → 开启焦点仿真 → attach。
 * 后台 tab 上 CDP `Input.*` 会被静默丢弃；焦点仿真让 tab 自认为聚焦即可接收输入，
 * 无需把 tab 抢到前台（Playwright / Claude-in-Chrome 同款做法），不打断用户。
 * 视口度量不在此处缓存：ref 类工具每次经 elementCenter 现采坐标；
 * click_at 的绝对坐标在工具内现采度量做越界校验（见下）。
 */
async function prepareInputTab(tabId?: number): Promise<{tabId: number; url: string}> {
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  await ensureFocusEmulation(target.tabId)
  return target
}

/** click 前把元素滚进视野并取中心点。stale 由 withRef 统一重试，这里不吞错。 */
async function locate(tabId: number, backendDOMNodeId: number): Promise<{x: number; y: number}> {
  await scrollIntoViewIfNeeded(tabId, backendDOMNodeId)
  return elementCenter(tabId, backendDOMNodeId)
}

/**
 * 页面上是否有「打开且可见」的对话框。
 * 只查存在性会误判：不少实现（如本地回归页）关闭 dialog 仅切 display:none，节点常驻 DOM，
 * 导致点击明明已生效仍触发键盘重试（对已隐藏节点 DOM.focus 报 not focusable）。
 */
const HAS_OPEN_DIALOG =
  '(function(){var els=document.querySelectorAll(\'[role="dialog"],dialog[open]\');' +
  'for (var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();' +
  'if (r.width>0&&r.height>0) return true}return false})()'

/**
 * 点击后渲染静置：两帧 rAF（框架同步重渲染落到 DOM）；后台 tab 的 rAF 可能被节流，
 * 以 300ms 兜底，保证不挂起。
 */
const RENDER_SETTLED =
  'new Promise(function(r){var t=setTimeout(function(){r(true)},300);' +
  'requestAnimationFrame(function(){requestAnimationFrame(function(){clearTimeout(t);r(true)})})})'

/** 点击后等弹层关闭动画结束再判断对话框是否仍在。 */
const DIALOG_SETTLE_MS = 150

export const click: ToolHandler = async (params) => {
  const {ref, tabId, snapshot: wantSnapshot} = params as {ref: string; tabId?: number; snapshot?: boolean}
  const target = await prepareInputTab(tabId)
  const dialogStillOpen = await withRef(target.tabId, ref, async (entry) => {
    const {x, y} = await locate(target.tabId, entry.backendDOMNodeId)
    // 只点一次、绝不自动补击：弹窗里「添加一行」这类按钮点完弹窗本就保持打开，
    // 补击会产生重复副作用。点击前后都有对话框时只回报给调用方，由其按快照判断。
    const dialogBefore = await evaluateJson<boolean>(target.tabId, HAS_OPEN_DIALOG)
    await dispatchClick(target.tabId, x, y)
    if (!dialogBefore) return false
    // 弹层关闭有动画/异步延迟，立即检查会把已关闭的弹窗误报为仍打开
    await new Promise((resolve) => setTimeout(resolve, DIALOG_SETTLE_MS))
    try {
      return await evaluateJson<boolean>(target.tabId, HAS_OPEN_DIALOG)
    } catch {
      return false
    }
  })
  const dialogField = dialogStillOpen ? {dialogStillOpen: true} : {}
  if (wantSnapshot !== true) return dialogField
  // 点击已生效：快照失败不能让调用方误以为点击失败而重点
  try {
    await evaluateJson<boolean>(target.tabId, RENDER_SETTLED)
    return {...dialogField, snapshot: await snapshot({tabId: target.tabId})}
  } catch (error) {
    return {...dialogField, snapshotError: error instanceof Error ? error.message : String(error)}
  }
}

/**
 * 坐标点击（ref 命中不了时的兜底：iframe / Canvas / 无 ref 的 icon-only 容器）。
 * 坐标默认是视口 CSS 像素；space="image" 时按本 tab 最近一次截图的比例换算成 CSS 像素，
 * 截图后视口变过则拒绝（旧比例不再成立）。直接走 CDP Input.*，不做元素解析。
 * button 支持左/中/右键，clickCount 支持双击，modifiers 支持组合键。
 * 越界坐标显式报错（现采视口度量）——静默落点是第二轮战报的教训。
 */
export const clickAt: ToolHandler = async (params) => {
  // run_actions 步骤绕过 server 校验：x/y 会拼进 hit-test 页面脚本，必须按 schema 校验而非 cast
  const parsed = parseToolParams('click_at', clickAtParams, params)
  const {tabId, button, clickCount, modifiers, space} = parsed
  const target = await prepareInputTab(tabId)
  const metrics = await getViewportMetrics(target.tabId)
  if (metrics.width <= 0 || metrics.height <= 0) {
    throw new Error(
      'WINDOW_NOT_INTERACTIVE: the viewport reads 0x0 (window minimized or tab hidden), ' +
        'input would be silently dropped. Restore the window and retry.',
    )
  }
  let {x, y} = parsed
  if (space === 'image') {
    const viewport = {width: Math.round(metrics.width), height: Math.round(metrics.height)}
    const converted = imagePointToCss(lastScreenshot(target.tabId), viewport, x, y)
    if (!converted.ok) throw new Error(`click_at space="image": ${converted.reason}`)
    x = converted.x
    y = converted.y
  }
  if (x < 0 || y < 0 || x > metrics.width || y > metrics.height) {
    throw new Error(
      `click_at (${x}, ${y}) is outside the viewport (${metrics.width}x${metrics.height} @dpr ${metrics.dpr}). ` +
        'Coordinates are viewport CSS pixels — re-measure with evaluate_script getBoundingClientRect and retry.',
    )
  }
  const options: ClickOptions = {
    ...(button !== undefined ? {button} : {}),
    ...(clickCount !== undefined ? {clickCount} : {}),
    ...(modifiers !== undefined ? {modifiers} : {}),
  }
  // 点击前 hit-test：点击可能导航/关弹层，事后再查会落到别的元素上。反馈失败不阻断点击。
  let hit: HitInfo | null | undefined
  try {
    hit = parseHitTestResult(await evaluateJson<unknown>(target.tabId, buildHitTestScript(x, y)))
  } catch {
    hit = undefined
  }
  await dispatchClick(target.tabId, x, y, options)
  return {
    ...(hit === undefined ? {} : {hit}),
    ...(space === 'image' ? {css: {x, y}} : {}),
  }
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

/**
 * 清空当前焦点元素：全选（附 selectAll 编辑命令）+ Delete。
 * 原生输入框键盘清空后仍有残留时，走原型 value setter 兜底（React 受控组件也能收到）；
 * 仍清不掉就显式报错，绝不把新文本追加到旧内容后面。
 */
async function clearFocused(tabId: number): Promise<void> {
  const selectAll = resolveKey('a')
  const del = resolveKey('Delete')
  if (!selectAll.ok || !del.ok) return
  await dispatchKey(tabId, selectAll.info, [selectAllModifier(navigator.userAgent)], ['selectAll'])
  await dispatchKey(tabId, del.info, [])
  const remaining = await readFocusedValue(tabId)
  if (remaining === null || remaining === '') return
  if (await clearFocusedNativeValue(tabId)) return
  throw new Error(
    `INPUT_NOT_LANDED: clear:true could not empty the field (still "${remaining.slice(0, 80)}") — ` +
      'select its content with press_key and Delete, then type without clear.',
  )
}

export const typeText: ToolHandler = async (params) => {
  const raw = params as {
    ref?: string
    text: string
    submit?: boolean
    mode?: 'insert' | 'verbatim' | 'set'
    clear?: boolean
    focus?: 'none' | 'click-ref'
    tabId?: number
  }
  const mode = raw.mode ?? 'insert'
  const focus = raw.focus ?? 'click-ref'
  const insertedLines = (raw.text.match(/\n/g) ?? []).length

  // verbatim 承诺「整段原样插入、零按键事件」：Enter 按键会触发 Monaco 自动缩进，必须拒绝
  if (mode === 'verbatim' && raw.submit === true) {
    throw new Error(
      'submit is not supported with mode="verbatim": pressing Enter would trigger editor auto-indent. ' +
        'Insert the text first, then call press_key(key="Enter") if a newline is wanted.',
    )
  }

  /**
   * set：monaco.setValue 原子写整个缓冲。绕开键盘/焦点/IME 通路——窗口失焦、
   * 键路死亡、编辑器塌缩都不影响，也无需点击聚焦（实测最稳的写盘路径）。
   * ref 可省：页面只有一个编辑器时自动选中。
   */
  if (mode === 'set') {
    if (raw.submit === true) {
      throw new Error(
        'submit is not supported with mode="set": activate the Run/Submit button by its ref instead.',
      )
    }
    if (raw.clear === true) {
      throw new Error('clear is redundant with mode="set": setValue replaces the whole buffer in one atomic write.')
    }
    const target = await authorizeTab(raw.tabId)
    await ensureAttached(target.tabId)
    const result =
      raw.ref !== undefined
        ? await withRef(target.tabId, raw.ref, async (entry) => {
          return monacoSetValue(target.tabId, entry.backendDOMNodeId, raw.text)
        })
        : await monacoSetValue(target.tabId, undefined, raw.text)
    if (result.kind === 'no-monaco') {
      throw new Error('mode="set" requires the page to expose window.monaco; use mode="insert" or "verbatim" instead.')
    }
    if (result.kind === 'ref-not-in-editor') {
      throw new Error(
        `the ref is not inside a monaco editor (${result.editorCount} editor(s) on the page); ` +
          'pass a ref inside the editor or omit ref to auto-target a single editor.',
      )
    }
    if (result.kind === 'ambiguous') {
      throw new Error(`${result.editorCount} monaco editors on the page — pass a ref inside the target editor.`)
    }
    return {
      mode: 'set',
      insertedLines,
      ...(result.layoutRecovered ? {layoutRecovered: true} : {}),
      ...(result.insertionPoint !== null ? {insertionPoint: result.insertionPoint} : {}),
    }
  }

  const target = await prepareInputTab(raw.tabId)

  /** 焦点落盘验证：读不到焦点状态（页面导航中等）按通过处理，绝不误伤。 */
  const readFocusSafe = async (): Promise<FocusState | null> => {
    try {
      return await readInputFocus(target.tabId)
    } catch {
      return null
    }
  }
  const assertLanded = (state: FocusState | null, when: 'before' | 'after'): void => {
    if (state === null || state.editable) return
    const hint =
      when === 'before'
        ? 'text would go nowhere. Click the editor/input ref first (or wait editorRendered), then retry.'
        : 'text did not land — focus left the editable during typing; re-click the target and verify with get_text.'
    throw new Error(`INPUT_NOT_LANDED: focus is on <${state.tag}> — ${hint}`)
  }
  const prepareKeyboardPath = async (): Promise<void> => {
    assertLanded(await readFocusSafe(), 'before')
    if (mode === 'verbatim' || raw.clear === true || raw.submit === true) {
      await ensureKeyPipelineAlive(target.tabId)
    }
  }

  /**
   * verbatim：按计划器逐步执行（文本逐字原样，前导空白/换行不做任何特殊处理）。
   * Chromium 会把多行 insertText 在渲染层拆成逐行 input 事件，换行走 typed-Enter
   * 路径 → Monaco autoIndent 逐行叠加缩进（实测 LeetCode Monaco 同款问题）。
   * 行间序列：Enter（带 '\r' 字符事件才生效）产生自动缩进后，Shift+Home 选中缩进
   * （光标在缩进后、行内容前，选中段恰为缩进本身）再 Delete 抹掉，
   * 下一行的缩进由文本自带，保证逐字符还原。
   */
  const typeVerbatim = async (): Promise<void> => {
    if (raw.clear === true) await clearFocused(target.tabId)
    const steps = planVerbatim(raw.text)
    const enter = resolveKey('Enter')
    const home = resolveKey('Home')
    const del = resolveKey('Delete')
    for (const step of steps) {
      if (step.kind === 'text') {
        await insertText(target.tabId, step.value)
      } else if (enter.ok && home.ok && del.ok) {
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

  // 结果带插入点概要 + 输入后落盘验证（焦点不在可编辑元素 = 文本必然没落盘）
  const buildResult = async (): Promise<{
    mode: 'insert' | 'verbatim'
    insertedLines: number
    insertionPoint?: CursorPosition
    value?: string
  }> => {
    const after = await readFocusSafe()
    assertLanded(after, 'after')
    // submit 后焦点可能已离开输入框（表单提交/弹窗关闭），回读的不是目标元素，不报
    const value = raw.submit === true ? null : await readFocusedValue(target.tabId).catch(() => null)
    return {
      mode,
      insertedLines,
      ...(after !== null && after.insertionPoint !== null
        ? {insertionPoint: after.insertionPoint}
        : {}),
      ...(value !== null ? {value} : {}),
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
    await prepareKeyboardPath()
    if (mode === 'verbatim') await typeVerbatim()
    else await typeInsert()
    return buildResult()
  }

  if (raw.ref === undefined) {
    throw new Error('ref is required unless focus="none"')
  }
  await withRef(target.tabId, raw.ref, async (entry) => {
    const {x, y} = await locate(target.tabId, entry.backendDOMNodeId)
    await dispatchClick(target.tabId, x, y)
    await prepareKeyboardPath()
    if (mode === 'verbatim') await typeVerbatim()
    else await typeInsert()
  })
  return buildResult()
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
  // 键路探针：resize/失焦后按键会静默丢失，死了先自愈、仍死显式报错
  await ensureKeyPipelineAlive(target.tabId)
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

/** 定位滚动：ref / selector / text 三选一，把元素滚到视口中央并回执 rect。 */
export const scrollTo: ToolHandler = async (params) => {
  const raw = parseToolParams('scroll_to', scrollToParams, params)
  const target = await authorizeTab(raw.tabId)
  await ensureAttached(target.tabId)

  let receipt: unknown
  if (raw.ref !== undefined) {
    // 与 selector/text 模式一致滚到视口中央（DOM.scrollIntoViewIfNeeded 只保证可见，常贴边）
    receipt = await withRef(target.tabId, raw.ref, async (entry) => {
      return describeNodeRect(target.tabId, entry.backendDOMNodeId, CENTER_AND_DESCRIBE)
    })
  } else {
    receipt = await evaluateJson<unknown>(
      target.tabId,
      buildScrollToScript(raw.selector !== undefined ? {selector: raw.selector} : {text: raw.text ?? ''}),
    )
  }
  const parsed = parseScrollToReceipt(receipt)
  if (parsed === null) {
    const what = raw.selector !== undefined ? `selector ${JSON.stringify(raw.selector)}` : `text ${JSON.stringify(raw.text)}`
    throw new Error(
      `scroll_to: no visible element matches ${what}. scroll_to only searches what is rendered now: ` +
        'if the target is on another page of a paginated table or not yet rendered by a virtual/lazy list, ' +
        'go to that page or scroll the list (scroll with a ref inside it) first; otherwise wait for it to render.',
    )
  }
  return parsed
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
