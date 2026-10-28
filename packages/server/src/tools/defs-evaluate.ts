/** Phase 3b 工具：受限 evaluateScript 与权限弹窗授权。 */
import {
  MAX_EVALUATE_CHARS,
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
    'Evaluate a JavaScript expression in the page context of the managed tab. ' +
    'The result text is the bare JSON value (strings are JSON-quoted), so it can be passed to JSON.parse directly; ' +
    'an undefined result is the text `undefined`. ' +
    'The script MAY change the page: DOM writes and element.click() are allowed, and it runs with a user gesture ' +
    'so handlers that need user activation work — prefer click(ref) when you want real input events. ' +
    'A blacklist rejects network access (fetch/XHR/WebSocket/sendBeacon), eval/Function, navigation ' +
    '(location assignment/window.open), document.write, debugger and chrome.*. ' +
    'Accepted forms: an expression (including ones starting with ! ~ + -), an IIFE, or a block. ' +
    'Pass awaitPromise:true with an async IIFE to await a Promise; wrap the expression in (async () => ...)() yourself. ' +
    `Results over ${MAX_EVALUATE_CHARS} characters (strings and JSON alike) are cut off and followed by a ` +
    '[TRUNCATED: kept N of M chars] line (the cut JSON no longer parses); return slices to read the rest.',
  schema: evaluateScriptParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'evaluate_script', args, evaluateScriptResult)
    const raw = String(result.value)
    const text = formatEvaluateValue(result.type, raw)
    if (!result.truncated) return toolText(text)
    // 截断值末尾带一个 '…'，不计入保留长度
    const kept = raw.endsWith('…') ? raw.length - 1 : raw.length
    const marker =
      result.originalLength !== undefined ? `[TRUNCATED: kept ${kept} of ${result.originalLength} chars]` : '[TRUNCATED]'
    return toolText(`${text}\n${marker}`)
  },
})

/**
 * 扩展回传的 value 已是文本：对象/数组为 JSON、数字/布尔为字面量，字符串是原文。
 * 字符串补 JSON 引号，使整个结果可直接 JSON.parse；undefined 不是 JSON，原样输出。
 */
export function formatEvaluateValue(type: string, value: string): string {
  return type === 'string' ? JSON.stringify(value) : value
}

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
