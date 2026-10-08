/** ref 交互工具：click / hover / type / press_key / scroll。ref 三态解析 + CDP 真实输入。 */
import {ensureAttached} from '../lib/cdp'
import {
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
  readInputFocus,
  scrollIntoViewIfNeeded,
  viewportCenter,
} from '../lib/cdp-commands'
import type {ClickOptions, CursorPosition, FocusState} from '../lib/cdp-commands'
import {resolveKey} from '../lib/keymap'
import type {InputModifier} from '../lib/keymap'
import {planVerbatim} from '../lib/verbatim'
import {authorizeTab} from './access'
import {withRef} from './ref-recovery'

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

export const click: ToolHandler = async (params) => {
  const {ref, tabId} = params as {ref: string; tabId?: number}
  const target = await prepareInputTab(tabId)
  await withRef(target.tabId, ref, async (entry) => {
    const {x, y} = await locate(target.tabId, entry.backendDOMNodeId)
    // 对话框守卫：弹窗项常因 React 重渲染在测量与点击之间挪位导致点击丢失。
    // 点击前有对话框、静置后仍在 → 重测坐标补一击（文本节点 ref 无法 DOM.focus，
    // 第二击是唯一通用补刀路径）；补击时元素已消失视为成功（弹层正在关闭）。
    const dialogBefore = await evaluateJson<boolean>(target.tabId, HAS_OPEN_DIALOG)
    await dispatchClick(target.tabId, x, y)
    if (dialogBefore) {
      const stillOpen = async (): Promise<boolean> => {
        // 弹层关闭有动画/异步延迟，立即检查会把已生效的点击误判为丢失
        await new Promise((resolve) => setTimeout(resolve, 150))
        return evaluateJson<boolean>(target.tabId, HAS_OPEN_DIALOG)
      }
      if (await stillOpen()) {
        try {
          const point = await locate(target.tabId, entry.backendDOMNodeId)
          await dispatchClick(target.tabId, point.x, point.y)
        } catch {
          // 重测失败 = 元素正在消失，原始点击大概率已生效
          return
        }
        if (await stillOpen()) {
          throw new Error(
            'click dispatched twice but the dialog is still open — snapshot to check its state and try a different target',
          )
        }
      }
    }
  })
  return {}
}

/**
 * 坐标点击（ref 命中不了时的兜底：iframe / Canvas / 无 ref 的 icon-only 容器）。
 * 坐标是视口 CSS 像素；直接走 CDP Input.*，不做元素解析。
 * button 支持左/中/右键，clickCount 支持双击，modifiers 支持组合键。
 * 越界坐标显式报错（现采视口度量，无任何跨调用缓存）——静默落点是第二轮战报的教训。
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
  const metrics = await getViewportMetrics(target.tabId)
  if (metrics.width <= 0 || metrics.height <= 0) {
    throw new Error(
      'WINDOW_NOT_INTERACTIVE: the viewport reads 0x0 (window minimized or tab hidden), ' +
        'input would be silently dropped. Restore the window and retry.',
    )
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
  }> => {
    const after = await readFocusSafe()
    assertLanded(after, 'after')
    return {
      mode,
      insertedLines,
      ...(after !== null && after.insertionPoint !== null
        ? {insertionPoint: after.insertionPoint}
        : {}),
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
