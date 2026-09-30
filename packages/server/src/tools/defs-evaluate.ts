/** Phase 3b 工具：受限 evaluateScript 与权限弹窗授权。 */
import {
  evaluateScriptParams,
  evaluateScriptResult,
  requestPermissionParams,
  requestPermissionResult,
} from '@chrome-in-harness/protocol'
import {callBridge, defineTool, toolText} from './types.js'
import type {ToolDef} from './types.js'

const evaluateScript = defineTool({
  name: 'evaluate_script',
  title: 'Run a restricted script in the page',
  description:
    'Evaluate a restricted JavaScript expression in the page context of the managed tab and return its JSON value. ' +
    'Only read-style scripts are allowed: network access (fetch/XHR/WebSocket/sendBeacon), eval/Function, ' +
    'navigation (location/window.open), document.write, debugger and chrome.* are rejected. ' +
    'Pass awaitPromise:true with an async IIFE to await a Promise; wrap the expression in (async () => ...)() yourself. ' +
    'Large results are truncated and flagged with truncated:true.',
  schema: evaluateScriptParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'evaluate_script', args, evaluateScriptResult)
    const suffix = result.truncated ? ' (TRUNCATED)' : ''
    return toolText(`<${result.type}> ${result.value}${suffix}`)
  },
})

const requestPermission = defineTool({
  name: 'request_permission',
  title: 'Request permission to operate on a domain',
  description:
    'Show the browser permission prompt to allow operating on a domain (matches the domain and all subdomains). ' +
    'SECURITY-SENSITIVE: only call this when the user explicitly asked for that domain to be allowed, ' +
    'never on your own initiative. On grant, the domain is also added to the allowlist. Returns {granted, domains}.',
  schema: requestPermissionParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'request_permission', args, requestPermissionResult)
    if (!result.granted) return toolText(`Permission denied by the user for ${args.domain}.`)
    return toolText(
      `Granted ${args.domain}. Allowlist now (${result.domains.length} domains):\n${result.domains.join('\n')}`,
    )
  },
})

export const EVALUATE_TOOL_DEFS: readonly ToolDef[] = [evaluateScript, requestPermission]

export type {ToolDef}
