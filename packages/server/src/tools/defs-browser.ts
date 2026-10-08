/** 浏览器操作工具：navigate / snapshot / click / hover / type / press_key / scroll / screenshot / get_text。 */
import {
  clickAtParams,
  clickParams,
  getTextParams,
  getTextResult,
  hoverParams,
  pressKeyParams,
  waitParamsShape,
  waitResult,
  navigateParams,
  navigateResult,
  okResult,
  scrollParams,
  screenshotParams,
  screenshotResult,
  snapshotParams,
  snapshotResult,
  typeParams,
  typeResult,
} from '@chrome-in-harness/protocol'
import {callBridge, defineTool, toolImage, toolText} from './types.js'
import type {ToolDef} from './types.js'

const navigate = defineTool({
  name: 'navigate',
  title: 'Navigate to a URL',
  description:
    'Navigate the tab to a URL and wait for the chosen readiness signal. ' +
    'waitUntil: "load" (wait for the load event), "domcontentloaded" (default; DOM ready + 500ms quiet), ' +
    '"networkidle" (DOM ready + no in-flight network requests for 500ms). ' +
    'Waits up to ~8s; a timeout is reported but the page is often still usable — snapshot to check. ' +
    'On React SPAs, event handlers may attach AFTER load (hydration): clicking right after navigate can be ' +
    'silently ineffective — wait for an app-specific marker (wait text/selector) before the first click.',
  schema: navigateParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'navigate', args, navigateResult)
    const strategy = result.waitUntil ?? 'domcontentloaded'
    const suffix = result.loaded
      ? ''
      : strategy === 'networkidle'
        ? ' (readiness signal timed out; content may be incomplete or network never went idle)'
        : strategy === 'load'
          ? ' (load event timed out; content may be incomplete)'
          : ' (DOMContentLoaded timed out; content may be incomplete)'
    return toolText(`Navigated to ${result.url}${suffix}${result.title ? ` — "${result.title}"` : ''}`)
  },
})

const snapshot = defineTool({
  name: 'snapshot',
  title: 'Accessibility snapshot with refs',
  description:
    'Render the page accessibility tree as an indented text snapshot. Interactive elements carry [ref=eN-<token>] ids ' +
    '(the token encodes worker generation + snapshot version: refs from before a service-worker restart or an older ' +
    'snapshot are rejected with STALE_REF instead of silently remapped — re-snapshot to continue). ' +
    'Weakly-interactive custom controls (clickable div/li/span without ARIA roles) are marked [weak] but also usable. ' +
    'Pass refs to click/hover/type/press_key/scroll/get_text. ' +
    'Optional filters for long pages: query — case-insensitive regex over role/name; interactive hits ' +
    '(buttons/links/textboxes/options + weak controls) are listed first with their subtrees, text-only hits ' +
    'render as single lines after them (same-rank order is DOM order) — so query "Submit" surfaces the button, ' +
    'not comment posts that merely mention it; ' +
    'rootRef — render only that node\'s subtree; limit — character budget. ' +
    'Refs are never dropped by truncation: on overflow, text-only subtrees are hidden first.',
  schema: snapshotParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'snapshot', args, snapshotResult)
    const header = `Snapshot of ${result.url} (version ${result.version})${result.truncated ? ' — TRUNCATED' : ''}\n\n`
    return toolText(header + result.snapshot)
  },
})

const click = defineTool({
  name: 'click',
  title: 'Click an element by ref',
  description:
    'Click the element with the given ref from the latest snapshot. ' +
    'When the click targets a button inside an open dialog and the dialog is still present afterwards, ' +
    'the click is retried once via keyboard activation (focus + Enter) — dialog buttons sometimes move between measure and click.',
  schema: clickParams.shape,
  async run(args, call) {
    await callBridge(call, 'click', args, okResult)
    return toolText(`Clicked ${args.ref}`)
  },
})

const hover = defineTool({
  name: 'hover',
  title: 'Hover an element by ref',
  description: 'Move the mouse over the element with the given ref.',
  schema: hoverParams.shape,
  async run(args, call) {
    await callBridge(call, 'hover', args, okResult)
    return toolText(`Hovered ${args.ref}`)
  },
})

const clickAt = defineTool({
  name: 'click_at',
  title: 'Click at viewport coordinates',
  description:
    'Click at raw viewport coordinates (CSS pixels). Escape hatch for targets a ref cannot reach: ' +
    'elements inside iframes/Canvas, and icon-only containers with no accessible name (e.g. a "..." menu). ' +
    'Requires coordinates:true to signal intent. ' +
    'Options: button "left"|"right"|"middle" (right-click opens context menus), clickCount 2 for double-click, ' +
    'modifiers ["ctrl"|"alt"|"shift"|"meta"] for chords. ' +
    'Out-of-viewport coordinates fail with an explicit error (viewport metrics are re-measured per call). ' +
    'To find coordinates, first locate the element with evaluate_script, e.g. ' +
    'evaluate_script expression `(()=>{const r=document.querySelector(".some-btn").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, ' +
    'then click_at with that x/y. Prefer click(ref) when a ref exists.',
  schema: clickAtParams.shape,
  async run(args, call) {
    await callBridge(call, 'click_at', args, okResult)
    const detail = args.button && args.button !== 'left' ? ` ${args.button}` : ''
    const count = args.clickCount && args.clickCount > 1 ? ` x${args.clickCount}` : ''
    return toolText(`Clicked${detail}${count} at (${args.x}, ${args.y})`)
  },
})

const type = defineTool({
  name: 'type',
  title: 'Type text into an element by ref',
  description:
    'Type text into an element. Default behavior: click the element (focusing it), insert the text, ' +
    'and press Enter when submit is true. ' +
    'Text is inserted verbatim — leading/trailing whitespace and newlines are preserved with no trimming. ' +
    'mode:"set" is the most robust path for Monaco editors: one atomic setValue of the WHOLE buffer via the ' +
    'window.monaco API — immune to keyboard-pipeline death (window resize/focus loss), editor collapse and ' +
    'focus races; no click needed, ref optional when the page has exactly one editor. ' +
    'mode:"verbatim" guarantees exact reproduction through the input pipeline: per-line insertion with newline ' +
    'handling that bypasses Monaco auto-indent and bracket auto-closing. ' +
    'submit is rejected with verbatim/set (activate the Run/Submit button by its ref instead). ' +
    'clear:true empties the field first (focus + Ctrl+A + Delete); redundant and rejected with set. ' +
    'focus:"none" skips the implicit click: with ref it only DOM.focuses the element (caret stays put); ' +
    'without ref it types into whatever is focused. ' +
    'Landing is verified: when focus is not on an editable element the call fails with INPUT_NOT_LANDED ' +
    'instead of silently discarding the text. Returns the caret landing point insertionPoint {line, col} ' +
    '(1-based) and insertedLines for self-checking where the text landed.',
  schema: typeParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'type', args, typeResult)
    const bits: string[] = []
    if (result.mode === 'set') bits.push('set via monaco setValue')
    if (result.mode === 'verbatim') bits.push('verbatim')
    if (args.clear === true) bits.push('cleared first')
    if (args.focus === 'none') bits.push('no click')
    if (result.insertedLines > 0) bits.push(`${result.insertedLines + 1} lines`)
    if (result.insertionPoint !== undefined) {
      bits.push(`cursor at L${result.insertionPoint.line}:C${result.insertionPoint.col}`)
    }
    const suffix = bits.length > 0 ? ` (${bits.join(', ')})` : ''
    return toolText(
      `Typed into ${args.ref ?? 'focused element'}${suffix}${args.submit ? ' and pressed Enter' : ''}`,
    )
  },
})

const pressKey = defineTool({
  name: 'press_key',
  title: 'Press a key or key combination',
  description:
    'Press a single key, optionally with modifiers. key examples: Enter, Backspace, Delete, Escape, Tab, ' +
    'ArrowUp/Down/Left/Right, Home, End, PageUp/PageDown, Insert, F1-F24, Space, or a single character (a, A, !, :, space). ' +
    'modifiers: ["ctrl"|"alt"|"shift"|"meta"] — e.g. press_key(key:"a", modifiers:["ctrl"]) selects all. ' +
    'Pass ref to scroll the element into view, DOM.focus it (no click), then press; otherwise the key goes to the current focus. ' +
    'Key delivery is probed first: after window resize/focus loss CDP key events can be silently dropped ' +
    '(IME insertion still works) — the tool re-focuses the window to recover and fails loudly with ' +
    'KEY_PIPELINE_DEAD when keys would not land; switch to type(mode="set") or click-based activation then.',
  schema: pressKeyParams.shape,
  async run(args, call) {
    await callBridge(call, 'press_key', args, okResult)
    const mods = args.modifiers !== undefined && args.modifiers.length > 0 ? `${args.modifiers.join('+')}+` : ''
    const target = args.ref ? ` on ${args.ref}` : ''
    return toolText(`Pressed ${mods}${args.key}${target}`)
  },
})

const getText = defineTool({
  name: 'get_text',
  title: 'Read an element\'s text by ref',
  description:
    'Return the text of the element with the given ref, capped at ~8KB (truncated:true when clipped). ' +
    'Reads the accessibility value first (ARIA semantics) — for virtual-scrolling editors like Monaco this is the ' +
    'FULL buffer text, whereas DOM innerText only covers visible lines. Falls back to innerText (nearest text-bearing ' +
    'ancestor included) for nodes without an AX value, e.g. buttons. Lightweight way to verify editor/content state.',
  schema: getTextParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'get_text', args, getTextResult)
    const suffix = result.truncated ? '… (TRUNCATED)' : ''
    return toolText(result.text + suffix)
  },
})

const scroll = defineTool({
  name: 'scroll',
  title: 'Scroll the page or an element',
  description:
    'Scroll up/down/left/right by a pixel amount. Pass ref to scroll that element into view first and wheel at its position; otherwise wheels at the viewport center.',
  schema: scrollParams.shape,
  async run(args, call) {
    await callBridge(call, 'scroll', args, okResult)
    const target = args.ref ? ` at ${args.ref}` : ''
    return toolText(`Scrolled ${args.direction} by ${args.amount ?? 600}px${target}`)
  },
})

const screenshot = defineTool({
  name: 'screenshot',
  title: 'Capture a screenshot',
  description: 'Capture a PNG screenshot of the visible viewport.',
  schema: screenshotParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'screenshot', args, screenshotResult)
    return toolImage(result.data, result.mimeType)
  },
})

const wait = defineTool({
  name: 'wait',
  title: 'Wait for a condition',
  description:
    'Wait until a condition holds on the page: text appears in the body, a CSS selector matches, the URL contains a substring, ' +
    'or editorRendered:true (a Monaco-style editor exists with height > 40px, width > 200px and a non-empty ' +
    'visible view-line — resize-collapsed editors are auto-recovered via monaco layout(); guards against both ' +
    'collapsed/hidden instances and 5x5 narrow-strip false readiness after window resizes). Exactly one condition per call. ' +
    'Returns {matched, timedOut} — a timeout is not an error; snapshot afterwards to see the current state.',
  // 注册无 refine 的 shape（refine 会破坏 tools/list 的 JSON schema）；四选一的约束在 run 里落地。
  schema: waitParamsShape,
  async run(args, call) {
    const conditions = [args.text, args.selector, args.urlContains, args.editorRendered].filter(
      (v) => v !== undefined,
    ).length
    if (conditions !== 1) {
      throw new Error(
        `exactly one of text / selector / urlContains / editorRendered is required (got ${conditions})`,
      )
    }
    const result = await callBridge(call, 'wait', args, waitResult)
    if (result.matched) return toolText('Condition matched.')
    return toolText('Timed out after waiting; condition not met. Take a snapshot to see the current state.')
  },
})

export const BROWSER_TOOL_DEFS: readonly ToolDef[] = [
  navigate,
  wait,
  snapshot,
  click,
  clickAt,
  hover,
  type,
  pressKey,
  getText,
  scroll,
  screenshot,
]

