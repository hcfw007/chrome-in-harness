/** 调试读取工具：console / network 缓冲，以及运行时白名单授权。 */
import {
  addAllowlistDomainParams,
  addAllowlistDomainResult,
  readConsoleParams,
  readConsoleResult,
  readNetworkParams,
  readNetworkResult,
  waitForResponseParams,
  waitForResponseResult,
} from '@chrome-in-harness/protocol'
import type {z} from 'zod'
import {callBridge, defineTool, toolText} from './types.js'
import type {ToolDef} from './types.js'

const readConsole = defineTool({
  name: 'read_console',
  title: 'Read console output',
  description:
    'Read the captured console messages (logs, warnings, errors, uncaught exceptions) of a tab. ' +
    'Buffering starts when the tab is first attached by a tool call — messages emitted before that are not available. ' +
    'Pass clear:true to drain the buffer after reading.',
  schema: readConsoleParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'read_console', args, readConsoleResult)
    if (result.entries.length === 0) return toolText('No console entries captured.')
    const lines = result.entries.map((e) => `[${e.level}] ${e.text}`)
    return toolText(lines.join('\n'))
  },
})

const readNetwork = defineTool({
  name: 'read_network',
  title: 'Read captured network requests',
  description:
    'Read captured network request metadata (method, URL, status, MIME type, duration, failure reason), newest first. ' +
    'Response bodies and headers are never captured; inline data: URLs are skipped. ' +
    'Failure reasons distinguish canceled / blocked:<reason> / cors:<error> / net::ERR_*; "pending" means no response yet. ' +
    'Buffering starts when the tab is first attached by a tool call. ' +
    'Pass urlFilter to keep only requests whose URL contains the substring.',
  schema: readNetworkParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'read_network', args, readNetworkResult)
    if (result.entries.length === 0) return toolText('No network requests captured.')
    return toolText(result.entries.map(formatNetworkEntry).join('\n'))
  },
})

type NetworkEntry = z.infer<typeof readNetworkResult>['entries'][number]

export function formatNetworkEntry(e: NetworkEntry): string {
  const outcome =
    e.error !== undefined
      ? `ERR ${e.error}`
      : e.status === undefined
        ? 'pending'
        : `${e.status}${e.mimeType !== undefined && e.mimeType.length > 0 ? ` ${e.mimeType}` : ''}`
  const duration = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : ''
  return `${e.method} ${e.url} → ${outcome}${duration}`
}

const waitForResponse = defineTool({
  name: 'wait_for_response',
  title: 'Wait for a network request to complete',
  description:
    'Wait until a request whose URL contains urlContains completes (optionally with a given status / method), ' +
    'e.g. after clicking a button that triggers an API call. Metadata only — the response body is never read. ' +
    'lookbackMs (default 2000) also accepts a match that completed just before this call, so click-then-wait is race-free; ' +
    'set 0 to wait only for future requests. Returns {matched, timedOut, entry}; a timeout is not an error.',
  schema: waitForResponseParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'wait_for_response', args, waitForResponseResult)
    if (result.matched && result.entry !== undefined) return toolText(`Matched: ${formatNetworkEntry(result.entry)}`)
    const filters = [args.method, args.status].filter((v) => v !== undefined).join(' ')
    return toolText(
      `Timed out: no ${filters.length > 0 ? `${filters} ` : ''}request matching ${JSON.stringify(args.urlContains)} completed. ` +
        'Check read_network for what was actually sent.',
    )
  },
})

const addAllowlistDomain = defineTool({
  name: 'add_allowlist_domain',
  title: 'Add a domain to the allowlist',
  description:
    'Add a domain to the operation allowlist (it matches the domain and all its subdomains). ' +
    'SECURITY-SENSITIVE: only call this when the user explicitly asked for that domain to be allowed, ' +
    'never on your own initiative. Returns the full updated list.',
  schema: addAllowlistDomainParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'add_allowlist_domain', args, addAllowlistDomainResult)
    return toolText(`Allowlist updated (${result.domains.length} domains):\n${result.domains.join('\n')}`)
  },
})

export const DEBUG_TOOL_DEFS: readonly ToolDef[] = [readConsole, readNetwork, waitForResponse, addAllowlistDomain]

export type {ToolDef}
