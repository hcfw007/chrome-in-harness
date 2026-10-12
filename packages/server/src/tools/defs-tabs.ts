/** 标签页管理工具 + ping（自 mcp.ts 迁入）。 */
import {
  ensureTabParams,
  ensureTabResult,
  okResult,
  tabCloseParams,
  tabListParams,
  tabListResult,
  tabNewParams,
  tabSelectParams,
  takeoverTabParams,
  takeoverTabResult,
} from '@chrome-in-harness/protocol'
import {z} from 'zod'
import {callBridge, defineTool, toolText} from './types.js'
import type {ToolDef} from './types.js'

const ping = defineTool({
  name: 'ping',
  title: 'Ping the Chrome extension',
  description: 'Check connectivity with the Chrome extension. Returns its version and userAgent.',
  schema: {},
  async run(_args, call) {
    const raw: unknown = await call('ping', {})
    return toolText(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))
  },
})

const tabList = defineTool({
  name: 'tab_list',
  title: 'List open tabs',
  description:
    'List all open tabs with their ids, titles and URLs. Tabs marked [managed] are inside the ' +
    '"Chrome in Harness" group and operable by the other tools.',
  schema: tabListParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'tab_list', args, tabListResult)
    const lines = result.tabs.map(
      (t) =>
        `tabId=${t.tabId}${t.active ? ' [active]' : ''}${
          t.managed ? ` [managed:${t.groupId}]` : ''
        } ${t.url}${t.title ? ` — "${t.title}"` : ''}`,
    )
    return toolText(lines.length > 0 ? lines.join('\n') : 'No open tabs.')
  },
})

const tabNew = defineTool({
  name: 'tab_new',
  title: 'Open a new tab',
  description: 'Open an additional tab in the background without changing the active tab, optionally navigating to a URL. Prefer ensure_tab to reuse your own tab; use tab_new only when multiple tabs are explicitly needed. Returns the new tab id. If manual interaction is needed, notify the user to switch to it; do not automatically call tab_select.',
  schema: tabNewParams.shape,
  async run(args, call) {
    const raw = await callBridge(call, 'tab_new', args, z.object({tabId: z.number().int()}))
    return toolText(`Opened tab ${raw.tabId}${args.url ? ` at ${args.url}` : ''}`)
  },
})

const tabSelect = defineTool({
  name: 'tab_select',
  title: 'Select a tab',
  description: 'Bring the tab with the given id to the front. Only call when the user explicitly asks you to switch tabs. For login, verification, or manual review, notify the user to switch themselves instead; do not automatically select a tab.',
  schema: tabSelectParams.shape,
  async run(args, call) {
    await callBridge(call, 'tab_select', args, okResult)
    return toolText(`Selected tab ${args.tabId}`)
  },
})

const ensureTab = defineTool({
  name: 'ensure_tab',
  title: 'Ensure a reusable agent tab',
  description: 'Reuse your supplied managed tabId, or create a background tab if no tabId is supplied or that tab was closed. Save the returned tabId and explicitly pass it to subsequent browser tools and ensure_tab calls. Each agent must keep its own handle; do not pick another agent\'s tab from tab_list. The optional url is used ONLY when creating, never to navigate a reused tab; use navigate with your tabId to change pages. A tab moved out of the managed group is an error, not permission to replace or take it over. Use tab_new only when multiple tabs are explicitly needed. Never switches focus.',
  schema: ensureTabParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'ensure_tab', args, ensureTabResult)
    return toolText(JSON.stringify(result))
  },
})

const tabClose = defineTool({
  name: 'tab_close',
  title: 'Close a tab',
  description: 'Close the tab with the given id.',
  schema: tabCloseParams.shape,
  async run(args, call) {
    await callBridge(call, 'tab_close', args, okResult)
    return toolText(`Closed tab ${args.tabId}`)
  },
})

const takeoverTab = defineTool({
  name: 'takeover_tab',
  title: 'Take over an already-open tab',
  description:
    'Move an existing (user-opened) tab into the "Chrome in Harness" group so tools can operate on it. ' +
    'SECURITY-SENSITIVE: only call this when the user explicitly asked to work in that tab, never on your own initiative. ' +
    'The tab URL must already be in the allowlist (otherwise the call fails and suggests request_permission). ' +
    'The user can revoke at any time by dragging the tab out of the group. Returns {tabId, url}.',
  schema: takeoverTabParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'takeover_tab', args, takeoverTabResult)
    return toolText(`Tab ${result.tabId} is now managed (${result.url}).`)
  },
})

export const TAB_TOOL_DEFS: readonly ToolDef[] = [ping, tabList, tabNew, tabSelect, tabClose, takeoverTab, ensureTab]
