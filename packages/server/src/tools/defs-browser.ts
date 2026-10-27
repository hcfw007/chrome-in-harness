/** 浏览器操作工具：navigate / snapshot / click / hover / type / press_key / scroll / screenshot / get_text。 */
import {
  clickAtParams,
  clickAtResult,
  clickParams,
  clickResult,
  countWaitConditions,
  getTextParams,
  getTextResult,
  hoverParamsError,
  hoverParamsShape,
  hoverResult,
  pressKeyParams,
  getHtmlParamsShape,
  getHtmlResult,
  locatorParamsError,
  probeParamsShape,
  probeResult,
  reloadParams,
  reloadResult,
  scrollToParamsShape,
  scrollToResult,
  selectOptionParams,
  selectOptionResult,
  waitParamsError,
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
import type {z} from 'zod'
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
    'rootRef — render only that node\'s subtree; limit — output CHARACTER budget (default 60000), not a node count: ' +
    'omit it unless you need a smaller response. ' +
    'On overflow, text-only subtrees are hidden first so refs survive; the footer reports what was dropped and a retry limit.',
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
    'Click the element with the given ref from the latest snapshot. The click is dispatched exactly once and never retried. ' +
    'When a dialog was open before the click and is still open afterwards, the result says so — that is normal for ' +
    'buttons that keep the dialog open (e.g. "add row"); snapshot to verify before clicking again. ' +
      'Pass snapshot: true to get a fresh full snapshot after the click (waits ~2 animation frames first); ' +
      'saves a round trip on pages that re-render and invalidate refs. For async content, use wait instead.',
  schema: clickParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'click', args, clickResult)
    const head = `Clicked ${args.ref}${result.dialogStillOpen === true ? ' (a dialog is still open)' : ''}`
    if (result.snapshot !== undefined) {
      const s = result.snapshot
      return toolText(
        `${head}\n\nSnapshot of ${s.url} (version ${s.version})${s.truncated ? ' — TRUNCATED' : ''}\n\n${s.snapshot}`,
      )
    }
    if (result.snapshotError !== undefined) {
      return toolText(`${head} (snapshot failed: ${result.snapshotError}; call snapshot to continue)`)
    }
    return toolText(head)
  },
})

const hover = defineTool({
  name: 'hover',
  title: 'Hover an element',
  description:
    'Move the mouse over an element, e.g. to open a tooltip or a hover menu. Pass exactly one of: ref (from snapshot), ' +
    'selector (CSS, first match — works for icon-only elements that have no ref), text (first visible element whose ' +
    'own text contains the substring), or x+y (viewport CSS pixels). selector/text scroll the element to the viewport ' +
    'center first. Returns the point that was hovered.',
  // 注册无 refine 的 shape（refine 会破坏 tools/list 的 JSON schema）；四选一在 run 里校验。
  schema: hoverParamsShape,
  async run(args, call) {
    const invalid = hoverParamsError(args)
    if (invalid !== undefined) throw new Error(invalid)
    const result = await callBridge(call, 'hover', args, hoverResult)
    const target =
      args.ref ?? (args.selector !== undefined ? JSON.stringify(args.selector) : args.text !== undefined ? `text ${JSON.stringify(args.text)}` : '')
    const at = result.x !== undefined && result.y !== undefined ? ` at (${round1(result.x)}, ${round1(result.y)})` : ''
    const label = result.tag !== undefined ? ` <${result.tag}>${result.text !== undefined ? ` "${result.text}"` : ''}` : ''
    return toolText(`Hovered${target.length > 0 ? ` ${target}` : ''}${label}${at}`)
  },
})

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

const clickAt = defineTool({
  name: 'click_at',
  title: 'Click at viewport coordinates',
  description:
    'Click at raw viewport coordinates (CSS pixels). Escape hatch for targets a ref cannot reach: ' +
    'elements inside iframes/Canvas, and icon-only containers with no accessible name (e.g. a "..." menu). ' +
    'Requires coordinates:true to signal intent. ' +
    'space:"image" means x/y were measured on this tab\'s latest screenshot; the tool converts them to CSS pixels ' +
    'and fails if the viewport changed since that screenshot (take a new one). ' +
    'Options: button "left"|"right"|"middle" (right-click opens context menus), clickCount 2 for double-click, ' +
    'modifiers ["ctrl"|"alt"|"shift"|"meta"] for chords. ' +
    'Out-of-viewport coordinates fail with an explicit error (viewport metrics are re-measured per call). ' +
    'To find coordinates, first locate the element with evaluate_script, e.g. ' +
    'evaluate_script expression `(()=>{const r=document.querySelector(".some-btn").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, ' +
    'then click_at with that x/y. Prefer click(ref) when a ref exists. ' +
    'The result reports the element under the point (hit-tested just before the click) and its nearest interactive ' +
    'ancestor — check it to tell a mis-aimed or covered click from a handler that did nothing.',
  schema: clickAtParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'click_at', args, clickAtResult)
    const detail = args.button && args.button !== 'left' ? ` ${args.button}` : ''
    const count = args.clickCount && args.clickCount > 1 ? ` x${args.clickCount}` : ''
    const where =
      result.css !== undefined
        ? `image (${args.x}, ${args.y}) → CSS (${result.css.x}, ${result.css.y})`
        : `(${args.x}, ${args.y})`
    return toolText(`Clicked${detail}${count} at ${where}${formatHit(result.hit)}`)
  },
})

function describeElement(tag: string, role: string | undefined, text: string, id?: string): string {
  const idPart = id !== undefined ? `#${id}` : ''
  const rolePart = role !== undefined ? ` role=${role}` : ''
  const textPart = text.length > 0 ? ` "${text}"` : ''
  return `<${tag}${idPart}${rolePart}>${textPart}`
}

/** hit 缺省 = 未能 hit-test（旧扩展或页面忙），不输出任何东西。 */
function formatHit(hit: z.infer<typeof clickAtResult>['hit']): string {
  if (hit === undefined) return ''
  if (hit === null) return '\nHit: nothing at this point (empty page area — no element besides <html>/<body>)'
  const {x, y, width, height} = hit.rect
  let line = `\nHit: ${describeElement(hit.tag, hit.role, hit.text, hit.id)} rect=${x},${y} ${width}x${height}`
  if (hit.inIframe === true) {
    line += '\nNote: the point is inside an iframe; the click lands in the child frame.'
  } else if (hit.interactive === undefined) {
    line += '\nNote: no clickable element (button/link/role/onclick/cursor:pointer) at or above the hit.'
  } else {
    line += `\nInteractive target: ${describeElement(hit.interactive.tag, hit.interactive.role, hit.interactive.text)}`
  }
  return line
}

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
    'A collapsed editor (resize artifact) is auto-recovered via forced layout() before writing — ' +
    'reported as layoutRecovered:true; no manual pre-check needed. ' +
    'mode:"verbatim" guarantees exact reproduction through the input pipeline: per-line insertion with newline ' +
    'handling that bypasses Monaco auto-indent and bracket auto-closing. ' +
    'submit is rejected with verbatim/set (activate the Run/Submit button by its ref instead). ' +
    'submit:true presses Enter after typing — inside a form or modal this usually submits or closes it; ' +
    'leave it off for filter fields in dialogs. ' +
    'clear:true empties the field first (select-all — Cmd+A on macOS, Ctrl+A elsewhere — then Delete) and fails with ' +
    'INPUT_NOT_LANDED instead of appending if content remains; redundant and rejected with set. ' +
    'focus:"none" skips the implicit click: with ref it only DOM.focuses the element (caret stays put); ' +
    'without ref it types into whatever is focused. ' +
    'Landing is verified: when focus is not on an editable element the call fails with INPUT_NOT_LANDED ' +
    'instead of silently discarding the text. Focus inside same-origin iframes (e.g. web terminals) is followed ' +
    'to the inner element; inside a cross-origin iframe it cannot be read, so the text is sent and the result is ' +
    'marked unverified — check it with a screenshot or get_text. ' +
    'text is capped at 10000 characters: split longer input across several calls, with submit only on the last. ' +
    'Returns the caret landing point insertionPoint {line, col} ' +
    '(1-based) and insertedLines for self-checking where the text landed, plus the field\'s resulting value ' +
    '(native inputs/textareas/contenteditable; omitted for Monaco and after submit).',
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
    if (result.layoutRecovered === true) bits.push('layout recovered')
    const suffix = bits.length > 0 ? ` (${bits.join(', ')})` : ''
    const value = result.value !== undefined ? `\nValue now: ${JSON.stringify(result.value)}` : ''
    const unverified =
      result.unverified === true
        ? '\nUnverified: focus is inside a cross-origin iframe, so landing could not be checked — confirm with a screenshot.'
        : ''
    return toolText(
      `Typed into ${args.ref ?? 'focused element'}${suffix}${args.submit ? ' and pressed Enter' : ''}${value}${unverified}`,
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
  description:
    'Capture a PNG screenshot of the visible viewport. Wide viewports are downscaled (long edge <= 1568 px) so the ' +
    'host never resizes the image again; the text part reports the image size and its ratio to CSS pixels. ' +
    'To click a point measured on the image, pass it to click_at with space:"image" — the tool converts it to CSS ' +
    'pixels using this tab\'s latest screenshot.',
  schema: screenshotParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'screenshot', args, screenshotResult)
    const image = toolImage(result.data, result.mimeType)
    if (result.width === undefined || result.height === undefined) return image
    return [...image, ...toolText(describeScreenshotPixels(result))]
  },
})

/** 保留两位小数，比例只给人读。 */
function ratio(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * 截图像素与 click_at 坐标的换算说明。新扩展回传 imageWidth/cssScale，直接如实报比例；
 * 旧扩展只有 scale（图片/设备像素），按旧规则推断。
 */
export function describeScreenshotPixels(result: z.infer<typeof screenshotResult>): string {
  const width = result.width ?? 0
  const height = result.height ?? 0
  const dpr = result.dpr ?? 1
  const viewport = `Viewport ${width}x${height} CSS px, dpr ${dpr}`
  if (result.imageWidth !== undefined && result.imageHeight !== undefined && result.cssScale !== undefined) {
    const image = `image ${result.imageWidth}x${result.imageHeight}`
    if (Math.abs(result.cssScale - 1) < 0.005) {
      return `${viewport}; ${image} — image px = CSS px, use these coordinates with click_at directly.`
    }
    return (
      `${viewport}; ${image} — 1 image px = ${ratio(1 / result.cssScale)} CSS px. ` +
      'Pass coordinates measured on this image to click_at with space:"image".'
    )
  }
  const scale = result.scale ?? 1
  if (scale !== 1) return `${viewport}; image px = CSS px (downscaled from dpr ${dpr}) — use these coordinates with click_at.`
  if (dpr === 1) return `${viewport}; image px = CSS px — use these coordinates with click_at.`
  return (
    `${viewport}; image px = DEVICE px (downscaling was unavailable) — ` +
    `divide coordinates measured on the image by ${dpr} before passing them to click_at.`
  )
}

const wait = defineTool({
  name: 'wait',
  title: 'Wait for a condition',
  description:
    'Wait until a condition holds on the page: text appears in the body, a CSS selector matches (use this before ' +
    'evaluate_script after a re-render so the DOM you read exists), the URL contains a substring, ' +
    'or editorRendered:true (a Monaco-style editor exists with height > 40px, width > 200px and a non-empty ' +
    'visible view-line — resize-collapsed editors are auto-recovered via monaco layout(); guards against both ' +
    'collapsed/hidden instances and 5x5 narrow-strip false readiness after window resizes), ' +
    'or networkIdle:true (no new network request for 500ms — e.g. after a click that triggers async fetches). ' +
    'At most one condition per call. To sleep, pass ONLY timeoutMs (e.g. {timeoutMs: 1000}, max 30000) — no dummy ' +
    'text condition needed; prefer a real condition when one exists. ' +
    'Returns {matched, timedOut} — a timeout is not an error; snapshot afterwards to see the current state.',
  // 注册无 refine 的 shape（refine 会破坏 tools/list 的 JSON schema）；条件约束在 run 里落地。
  schema: waitParamsShape,
  async run(args, call) {
    const invalid = waitParamsError(args)
    if (invalid !== undefined) throw new Error(invalid)
    const result = await callBridge(call, 'wait', args, waitResult)
    if (countWaitConditions(args) === 0) return toolText(`Waited ${args.timeoutMs}ms.`)
    if (result.matched) return toolText(args.networkIdle === true ? 'Network idle.' : 'Condition matched.')
    return toolText('Timed out after waiting; condition not met. Take a snapshot to see the current state.')
  },
})

const scrollTo = defineTool({
  name: 'scroll_to',
  title: 'Scroll an element into view',
  description:
    'Scroll so that an element is centered in the viewport. Pass exactly one of: ref (from snapshot), ' +
    'selector (CSS, first match), or text (first visible element whose own text contains the substring, case-sensitive). ' +
    'Returns the element\'s viewport rect after scrolling (CSS px, usable for click_at) and inViewport — ' +
    'false means it is still clipped (sticky header, nested scroll container, zero size).',
  schema: scrollToParamsShape,
  async run(args, call) {
    const invalid = locatorParamsError(args)
    if (invalid !== undefined) throw new Error(invalid)
    const result = await callBridge(call, 'scroll_to', args, scrollToResult)
    const {x, y, width, height} = result.rect
    const label = result.tag !== undefined ? ` <${result.tag}>${result.text !== undefined ? ` "${result.text}"` : ''}` : ''
    const state = result.inViewport ? 'in viewport' : 'NOT fully in viewport (clipped or zero-size)'
    return toolText(`Scrolled to${label} rect=${x},${y} ${width}x${height} — ${state}`)
  },
})

function formatProbe(result: z.infer<typeof probeResult>, args: {selector?: string}): string {
  if (!result.exists) {
    const count = args.selector !== undefined ? ` (0 matches for ${JSON.stringify(args.selector)})` : ''
    return `Not found${count}.`
  }
  const lines: string[] = []
  const head = `<${result.tag ?? '?'}>${result.text !== undefined && result.text.length > 0 ? ` "${result.text}"` : ''}`
  lines.push(result.count !== undefined && result.count > 1 ? `${head} — first of ${result.count} matches` : head)
  if (result.rect !== undefined) {
    const {x, y, width, height} = result.rect
    const state = result.visible === true ? (result.inViewport === true ? 'visible, in viewport' : 'visible, outside viewport') : 'NOT visible'
    lines.push(`rect=${x},${y} ${width}x${height} — ${state}`)
  }
  const attrs = Object.entries(result.attrs ?? {})
  if (attrs.length > 0) lines.push(`attrs: ${attrs.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`)
  return lines.join('\n')
}

const probe = defineTool({
  name: 'probe',
  title: 'Inspect an element without touching it',
  description:
    'Check whether an element exists and what state it is in, without scrolling or clicking. Pass exactly one of ' +
    'ref, selector (CSS, first match; reports the total match count) or text (first visible element whose own text ' +
    'contains the substring). Returns tag, text, viewport rect (CSS px), visible/inViewport, and allowlisted attributes ' +
    '(id, class, role, name, type, href, placeholder, title, alt, disabled, aria-*, data-testid). ' +
    'A missing element is reported as "Not found", not an error. Use this instead of ad-hoc evaluate_script probes.',
  schema: probeParamsShape,
  async run(args, call) {
    const invalid = locatorParamsError(args)
    if (invalid !== undefined) throw new Error(invalid)
    const result = await callBridge(call, 'probe', args, probeResult)
    return toolText(formatProbe(result, args))
  },
})

const getHtml = defineTool({
  name: 'get_html',
  title: 'Get an element\'s outerHTML',
  description:
    'Return the outerHTML of one element (ref, CSS selector, or visible text — exactly one), truncated to maxChars ' +
    '(default 4000, max 20000). Use it to see markup the accessibility snapshot hides (class names, data attributes, ' +
    'nested structure of custom controls). Prefer a narrow selector: whole-page HTML wastes context.',
  schema: getHtmlParamsShape,
  async run(args, call) {
    const invalid = locatorParamsError(args)
    if (invalid !== undefined) throw new Error(invalid)
    const result = await callBridge(call, 'get_html', args, getHtmlResult)
    const suffix = result.truncated ? `\n… (TRUNCATED: showing ${result.html.length} of ${result.length} chars; raise maxChars or narrow the selector)` : ''
    return toolText(result.html + suffix)
  },
})

const reload = defineTool({
  name: 'reload',
  title: 'Reload the page',
  description:
    'Reload the current page and wait like navigate (waitUntil: "load" | "domcontentloaded" (default) | "networkidle"). ' +
    'hard:true bypasses the HTTP cache — use it to check whether a deploy is live instead of adding cache-busting ' +
    'query params that change the route. All refs are invalidated; snapshot again afterwards.',
  schema: reloadParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'reload', args, reloadResult)
    const kind = result.hard ? 'Hard-reloaded (cache bypassed)' : 'Reloaded'
    const suffix = result.loaded ? '' : ' (readiness signal timed out; content may be incomplete)'
    return toolText(`${kind} ${result.url}${suffix}${result.title ? ` — "${result.title}"` : ''}`)
  },
})

const selectOption = defineTool({
  name: 'select_option',
  title: 'Choose an option in a dropdown',
  description:
    'Choose a dropdown option by its visible text. ref is the select trigger from snapshot: a native <select>, or the ' +
    'selector box of a custom dropdown (antd / Element / ARIA combobox). Native selects are set directly. Custom ' +
    'dropdowns are opened (unless already open), the matching visible option is clicked once with a real mouse event, ' +
    'and the trigger\'s displayed value is read back. Exact text matches win over substring matches; disabled options ' +
    'are refused. search:true types text into the dropdown\'s search box first — use it for long or virtualized lists ' +
    'whose target option is not rendered yet. On failure the error lists the options that were visible.',
  schema: selectOptionParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'select_option', args, selectOptionResult)
    const value = result.value !== undefined ? `; field now shows ${JSON.stringify(result.value)}` : ''
    return toolText(`Selected ${JSON.stringify(result.selected)} in ${args.ref} (${result.kind} select)${value}`)
  },
})

export const BROWSER_TOOL_DEFS: readonly ToolDef[] = [
  navigate,
  wait,
  snapshot,
  click,
  clickAt,
  hover,
  selectOption,
  type,
  pressKey,
  getText,
  scroll,
  scrollTo,
  reload,
  probe,
  getHtml,
  screenshot,
]

