/** 调试读取工具：console / network 缓冲，以及运行时白名单授权。 */
import {
  addAllowlistDomainParams,
  addAllowlistDomainResult,
  readConsoleParams,
  readConsoleResult,
  readNetworkParams,
  readNetworkResult,
} from '@chrome-in-harness/protocol'
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
    'Read captured network request metadata (method, URL, status, MIME type, failure reason), newest first. ' +
    'Response bodies are never captured. Buffering starts when the tab is first attached by a tool call. ' +
    'Pass urlFilter to keep only requests whose URL contains the substring.',
  schema: readNetworkParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'read_network', args, readNetworkResult)
    if (result.entries.length === 0) return toolText('No network requests captured.')
    const lines = result.entries.map((e) => {
      const status = e.error !== undefined ? `ERR ${e.error}` : `${e.status ?? '?'} ${e.mimeType ?? ''}`
      return `${e.method} ${e.url} → ${status.trim()}`
    })
    return toolText(lines.join('\n'))
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

export const DEBUG_TOOL_DEFS: readonly ToolDef[] = [readConsole, readNetwork, addAllowlistDomain]

export type {ToolDef}
