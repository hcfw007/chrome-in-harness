/** 标签页管理工具 + ping（自 mcp.ts 迁入）。 */
import {
  okResult,
  tabCloseParams,
  tabListParams,
  tabListResult,
  tabNewParams,
  tabSelectParams,
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
  description: 'List all open tabs with their ids, titles and URLs.',
  schema: tabListParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'tab_list', args, tabListResult)
    const lines = result.tabs.map(
      (t) => `tabId=${t.tabId}${t.active ? ' [active]' : ''} ${t.url}${t.title ? ` — "${t.title}"` : ''}`,
    )
    return toolText(lines.length > 0 ? lines.join('\n') : 'No open tabs.')
  },
})

const tabNew = defineTool({
  name: 'tab_new',
  title: 'Open a new tab',
  description: 'Open a new tab, optionally navigating to a URL. Returns the new tab id.',
  schema: tabNewParams.shape,
  async run(args, call) {
    const raw = await callBridge(call, 'tab_new', args, z.object({tabId: z.number().int()}))
    return toolText(`Opened tab ${raw.tabId}${args.url ? ` at ${args.url}` : ''}`)
  },
})

const tabSelect = defineTool({
  name: 'tab_select',
  title: 'Select a tab',
  description: 'Bring the tab with the given id to the front.',
  schema: tabSelectParams.shape,
  async run(args, call) {
    await callBridge(call, 'tab_select', args, okResult)
    return toolText(`Selected tab ${args.tabId}`)
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

export const TAB_TOOL_DEFS: readonly ToolDef[] = [ping, tabList, tabNew, tabSelect, tabClose]
