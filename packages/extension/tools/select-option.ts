/**
 * select_option 工具：按可见文本选择下拉项，覆盖原生 <select> 与自定义下拉（antd / Element / ARIA listbox）。
 * 原生 <select> 直接设值；自定义下拉：点开触发器 → 轮询可见选项 → CDP 真实点击匹配项 → 回读触发器显示值。
 * 不做任何「没选中就再点一次」的重试：重复点击在多选下拉里会把刚选的项取消。
 */
import {selectOptionParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {
  describeNodeRect,
  dispatchClick,
  elementCenter,
  ensureFocusEmulation,
  evaluateJson,
  insertText,
  scrollIntoViewIfNeeded,
} from '../lib/cdp-commands'
import {
  buildFindOptionScript,
  buildNativeSelectFn,
  HAS_CLOSING_OPTIONS,
  HAS_VISIBLE_OPTIONS,
  parseFindOptionReceipt,
  parseNativeSelectReceipt,
  READ_SELECT_DISPLAY_FN,
} from '../lib/option-locate'
import type {FindOptionReceipt} from '../lib/option-locate'
import {authorizeTab} from './access'
import {parseToolParams} from './params'
import {withRef} from './ref-recovery'

import type {ToolHandler} from './types'

const DEFAULT_TIMEOUT_MS = 3_000
const POLL_INTERVAL_MS = 100
/** 选中后等下拉关闭、触发器重渲染再回读。 */
const SETTLE_MS = 200
/** 等上一个下拉的关闭动画结束的上限（antd 约 200ms）。 */
const CLOSING_WAIT_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollForOption(tabId: number, text: string, timeoutMs: number): Promise<FindOptionReceipt | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const last = parseFindOptionReceipt(await evaluateJson<unknown>(tabId, buildFindOptionScript(text)))
    if (last !== null && last.kind !== 'none') return last
    if (Date.now() >= deadline) return last
    await sleep(POLL_INTERVAL_MS)
  }
}

function listOptions(options: readonly string[]): string {
  if (options.length === 0) return 'no visible options'
  return `visible options: ${options.map((o) => JSON.stringify(o)).join(', ')}`
}

export const selectOption: ToolHandler = async (params) => {
  const raw = parseToolParams('select_option', selectOptionParams, params)
  const target = await authorizeTab(raw.tabId)
  await ensureAttached(target.tabId)
  await ensureFocusEmulation(target.tabId)
  const timeoutMs = raw.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return withRef(target.tabId, raw.ref, async (entry) => {
    const native = parseNativeSelectReceipt(
      await describeNodeRect(target.tabId, entry.backendDOMNodeId, buildNativeSelectFn(raw.text)),
    )
    if (native === null) throw new Error('select_option: could not inspect the referenced element; take a new snapshot')
    if (native.kind === 'ok') return {kind: 'native', selected: native.text, value: native.text}
    if (native.kind === 'disabled') throw new Error(`select_option: option ${JSON.stringify(native.text)} is disabled`)
    if (native.kind === 'none') {
      throw new Error(`select_option: no option of the <select> matches ${JSON.stringify(raw.text)}; ${listOptions(native.options)}`)
    }

    // 上一个下拉正在关闭（选项可见但已不可点）：等动画结束，否则会把它误判为「已展开」而不点触发器
    const closingDeadline = Date.now() + CLOSING_WAIT_MS
    while (Date.now() < closingDeadline && (await evaluateJson<unknown>(target.tabId, HAS_CLOSING_OPTIONS)) === true) {
      await sleep(POLL_INTERVAL_MS)
    }
    // 下拉已展开时不再点触发器：再点一次会把它关掉
    const alreadyOpen = (await evaluateJson<unknown>(target.tabId, HAS_VISIBLE_OPTIONS)) === true
    if (!alreadyOpen) {
      await scrollIntoViewIfNeeded(target.tabId, entry.backendDOMNodeId)
      const {x, y} = await elementCenter(target.tabId, entry.backendDOMNodeId)
      await dispatchClick(target.tabId, x, y)
    }
    if (raw.search === true) await insertText(target.tabId, raw.text)

    const found = await pollForOption(target.tabId, raw.text, timeoutMs)
    if (found === null) throw new Error('select_option: the page did not return a usable option list; take a new snapshot')
    if (found.kind === 'disabled') {
      throw new Error(
        `select_option: option ${JSON.stringify(found.text)} is disabled; the dropdown was left open ` +
          '(one Escape closes it — a second Escape may close the surrounding modal)',
      )
    }
    if (found.kind === 'covered') {
      throw new Error(
        `select_option: option ${JSON.stringify(found.text)} is covered by another element, so a click would miss it — ` +
          'take a screenshot to see what overlays the dropdown',
      )
    }
    if (found.kind === 'none') {
      const hint =
        found.count === 0
          ? 'the dropdown did not open — check that ref is the select trigger'
          : 'the option may be outside the rendered part of a virtual list: pass search:true to filter by typing, ' +
            'or scroll the list first'
      throw new Error(`select_option: no visible option matches ${JSON.stringify(raw.text)} after ${timeoutMs}ms; ${listOptions(found.options)}. ${hint}`)
    }

    await dispatchClick(target.tabId, found.x, found.y)
    await sleep(SETTLE_MS)
    let value: string | undefined
    try {
      const display = await describeNodeRect(target.tabId, entry.backendDOMNodeId, READ_SELECT_DISPLAY_FN)
      if (typeof display === 'string') value = display
    } catch {
      // 触发器在选中后被重渲染替换：点击已生效，只是读不回显示值
      value = undefined
    }
    return {kind: 'custom', selected: found.text, ...(value !== undefined ? {value} : {})}
  })
}
