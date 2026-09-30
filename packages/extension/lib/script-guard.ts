/**
 * 受限 evaluateScript 的脚本守卫（纯逻辑，零 chrome.* 依赖）。
 *
 * 语义：允许用户在目标 tab 的页面上下文里执行一段 JS，但这是当前工作区内
 * 权限最高的原语（能读页面 DOM、能改页面状态），所以收紧到只允许
 * 「读取/查询页面状态」类脚本。规则是黑名单 + 形式校验，不追求静态分析完备
 * —— 一个真要用 XSS/注入的人本就走别的路子，这里挡住的是模型自编的越权脚本。
 */

export interface ScriptVerdict {
  readonly ok: true
  readonly expression: string
}

export interface ScriptRejection {
  readonly ok: false
  readonly reason: string
}

export type ScriptGuardResult = ScriptVerdict | ScriptRejection

/** 允许的顶层语法形态：IIFE / 表达式 / 块（await 必需时包 IIFE）。 */
const TOP_LEVEL_PATTERN =
  /^\s*(?:\(?(?:async\s*)?\(\)\s*=>|\(async\s*\(\)\s*=>|\(|[\w$.[\]'"`]|\{)/

/** 危险标识：一旦出现即拒绝。黑名单靠子串匹配（不区分大小写）。 */
const FORBIDDEN_PATTERNS: readonly {pattern: RegExp; reason: string}[] = [
  {pattern: /\bfetch\s*\(/i, reason: 'network access via fetch() is not allowed'},
  {pattern: /\bXMLHttpRequest\b/, reason: 'network access via XMLHttpRequest is not allowed'},
  {pattern: /\bWebSocket\b/, reason: 'network access via WebSocket is not allowed'},
  {pattern: /\bnavigator\s*\.\s*sendBeacon\b/i, reason: 'network access via sendBeacon is not allowed'},
  {pattern: /<\s*script\b/i, reason: 'script tag injection is not allowed'},
  {pattern: /\beval\s*\(/i, reason: 'eval() is not allowed'},
  {pattern: /\bnew\s+Function\b/i, reason: 'Function constructor is not allowed'},
  {pattern: /\bdocument\s*\.\s*(?:write|writeln|open)\s*\(/i, reason: 'document.write/open is not allowed'},
  {pattern: /\blocation\s*\.\s*(?:href|assign|replace|reload)\s*=/i, reason: 'navigation via location is not allowed'},
  {pattern: /\bwindow\s*\.\s*open\s*\(/i, reason: 'window.open is not allowed'},
  {pattern: /chrome\s*\./i, reason: 'chrome.* APIs are not reachable from page context and are not allowed'},
  {pattern: /\bdebugger\b/, reason: 'debugger statement is not allowed'},
]

/** 需要 await 时的顶层形态：整个表达式必须是 async IIFE。 */
const ASYNC_IIFE = /^\s*\(?\s*async\s*\(?\s*\)\s*=>|^\s*\(async\s*\(\)\s*=>/

export function guardScript(expression: string, awaitPromise: boolean): ScriptGuardResult {
  if (expression.length === 0) return {ok: false, reason: 'expression is empty'}
  if (expression.length > 8_000) return {ok: false, reason: 'expression exceeds 8000 characters'}

  if (awaitPromise) {
    if (!ASYNC_IIFE.test(expression)) {
      return {ok: false, reason: 'awaitPromise requires an async IIFE: (async () => { ... })()'}
    }
  } else if (!TOP_LEVEL_PATTERN.test(expression)) {
    return {ok: false, reason: 'expression must start with an IIFE, an expression, or a block'}
  }

  for (const {pattern, reason} of FORBIDDEN_PATTERNS) {
    if (pattern.test(expression)) return {ok: false, reason}
  }
  return {ok: true, expression}
}
