/** 标签页管理工具 + ping（自 mcp.ts 迁入）。 */
import {
  ensureTabParams,
  ensureTabResult,
  okResult,
  pingResult,
  reloadExtensionParams,
  reloadExtensionResult,
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
import type {BridgeCall, ToolDef} from './types.js'

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
    'Move an existing, user-opened tab (one tab_list shows WITHOUT [managed]) into the "Chrome in Harness" group so the ' +
    'other tools can operate on it. Calling it on a tab that is already managed is a no-op. ' +
    'SECURITY-SENSITIVE: only call this when the user explicitly asked to work in that tab, never on your own initiative. ' +
    'Side effects are limited: it never activates, focuses or navigates the tab and never moves it to another window ' +
    '(it joins a managed group in the same window, or starts one there; the tab may shift position in its tab strip). ' +
    'Refusals: TAB_CLOSED (gone), DOMAIN_CONFIRMATION_REQUIRED / DOMAIN_NOT_ALLOWED (URL not allowlisted), ' +
    'TAB_IN_USER_GROUP (it sits in one of the user\'s own groups, which is never broken up). ' +
    'If the result says the tab is the one the user is viewing, tell the user: later actions are visible to them, and ' +
    'calls that omit tabId may target it. The user can revoke at any time by dragging the tab out of the group.',
  schema: takeoverTabParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'takeover_tab', args, takeoverTabResult)
    const head =
      result.alreadyManaged === true
        ? `Tab ${result.tabId} was already managed (${result.url}); nothing changed.`
        : `Tab ${result.tabId} is now managed (${result.url}). Focus and URL were not changed.`
    const viewing =
      result.active === true
        ? '\nNote: this is the tab the user is currently viewing — actions on it are visible to them, ' +
          'and calls that omit tabId may resolve to it. Pass tabId explicitly.'
        : ''
    return toolText(head + viewing)
  },
})

/** 重载后等待扩展重连的上限：SW 重启 + WS 退避首轮 1s，留足余量。 */
export const RELOAD_RECONNECT_TIMEOUT_MS = 20_000
const RELOAD_POLL_INTERVAL_MS = 500

async function readStartedAt(call: BridgeCall): Promise<number | undefined> {
  const result = pingResult.safeParse(await call('ping', {}))
  return result.success ? result.data.startedAt : undefined
}

/**
 * 轮询 ping 直到扩展重连且 SW 是新的一代（startedAt 变化）。
 * 旧扩展的 ping 不带 startedAt：只要重连成功就算完成。
 */
export async function waitForFreshExtension(
  call: BridgeCall,
  previousStartedAt: number | undefined,
  timeoutMs = RELOAD_RECONNECT_TIMEOUT_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{reconnected: boolean; startedAt?: number}> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(RELOAD_POLL_INTERVAL_MS)
    try {
      const startedAt = await readStartedAt(call)
      if (previousStartedAt === undefined || startedAt === undefined || startedAt !== previousStartedAt) {
        return startedAt === undefined ? {reconnected: true} : {reconnected: true, startedAt}
      }
    } catch {
      // 断连或重连中：继续轮询
    }
  }
  return {reconnected: false}
}

const reloadExtension = defineTool({
  name: 'reload_extension',
  title: 'Reload the Chrome extension (development)',
  description:
    'Reload the unpacked Chrome in Harness extension from disk — same as clicking ↻ on chrome://extensions — ' +
    'then wait until it reconnects. Use after `npm run build:extension` to pick up new extension code. ' +
    'Only works for a development (unpacked) install. All refs and debugger sessions are dropped: take a new snapshot afterwards. ' +
    'Tool schemas do not change: if the build added or changed tool parameters, the MCP server and client session still need a restart.',
  schema: reloadExtensionParams.shape,
  async run(args, call) {
    const before = await readStartedAt(call)
    const result = await callBridge(call, 'reload_extension', args, reloadExtensionResult)
    const fresh = await waitForFreshExtension(call, before)
    if (!fresh.reconnected) {
      return toolText(
        `Extension ${result.version} reload was triggered, but it did not reconnect within ${RELOAD_RECONNECT_TIMEOUT_MS / 1000}s. ` +
          'Check chrome://extensions for load errors (a broken build will not start).',
      )
    }
    const info = await call('ping', {}).catch(() => undefined)
    const parsed = pingResult.safeParse(info)
    const version = parsed.success ? parsed.data.version : result.version
    return toolText(`Extension reloaded and reconnected (version ${version}). Refs are invalidated — snapshot again.`)
  },
})

export const TAB_TOOL_DEFS: readonly ToolDef[] = [
  ping,
  tabList,
  tabNew,
  tabSelect,
  tabClose,
  takeoverTab,
  ensureTab,
  reloadExtension,
]
