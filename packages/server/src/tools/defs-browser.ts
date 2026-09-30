/** 浏览器操作工具：navigate / snapshot / click / hover / type / scroll / screenshot。 */
import {
  clickParams,
  hoverParams,
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
} from '@chrome-in-harness/protocol'
import {callBridge, defineTool, toolImage, toolText} from './types.js'
import type {ToolDef} from './types.js'

const navigate = defineTool({
  name: 'navigate',
  title: 'Navigate to a URL',
  description: 'Navigate the tab to a URL and wait for the page load (up to 8s).',
  schema: navigateParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'navigate', args, navigateResult)
    const suffix = result.loaded ? '' : ' (load event timed out; content may be incomplete)'
    return toolText(`Navigated to ${result.url}${suffix}${result.title ? ` — "${result.title}"` : ''}`)
  },
})

const snapshot = defineTool({
  name: 'snapshot',
  title: 'Accessibility snapshot with refs',
  description:
    'Render the page accessibility tree as an indented text snapshot. Interactive elements carry [ref=eN] ids; pass them to click/hover/type/scroll. Re-snapshot after navigation — refs go stale.',
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
  description: 'Click the element with the given ref from the latest snapshot.',
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

const type = defineTool({
  name: 'type',
  title: 'Type text into an element by ref',
  description:
    'Click the element (focusing it), type the text, and optionally press Enter when submit is true.',
  schema: typeParams.shape,
  async run(args, call) {
    await callBridge(call, 'type', args, okResult)
    return toolText(`Typed into ${args.ref}${args.submit ? ' and pressed Enter' : ''}`)
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
    'Wait until a condition holds on the page: text appears in the body, a CSS selector matches, or the URL contains a substring. Exactly one condition per call. Returns {matched, timedOut} — a timeout is not an error; snapshot afterwards to see the current state.',
  schema: waitParamsShape,
  async run(args, call) {
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
  hover,
  type,
  scroll,
  screenshot,
]

