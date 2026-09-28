/**
 * 域名白名单匹配（纯逻辑，零 chrome.* 依赖）。
 *
 * 规则语义：`example.com` 匹配自身与任意深度子域（点边界后缀）；
 * `*.example.com` 仅为等价语法糖；端口剥离；一律小写比较；
 * IP 字面量精确相等；无 host 的 URL（about:blank、chrome://…）一律不允许。
 */

export interface NormalizeOk {
  readonly ok: true
  readonly rule: string
}

export interface NormalizeErr {
  readonly ok: false
  readonly error: string
}

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/

/** 把用户输入的一行规则归一成 bare host；非法返回错误说明。 */
export function normalizeHostRule(input: string): NormalizeOk | NormalizeErr {
  let rule = input.trim().toLowerCase()
  if (rule.length === 0) return {ok: false, error: 'empty rule'}

  // 剥 scheme 与路径（容忍用户粘贴完整 URL）
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//.exec(rule)
  if (schemeMatch !== null) rule = rule.slice(schemeMatch[0].length)
  const slash = rule.indexOf('/')
  if (slash !== -1) rule = rule.slice(0, slash)

  // 剥端口
  const colon = rule.lastIndexOf(':')
  if (colon !== -1) {
    const port = rule.slice(colon + 1)
    if (!/^\d+$/.test(port)) return {ok: false, error: `invalid port in "${input.trim()}"`}
    rule = rule.slice(0, colon)
  }

  // `*.` 只是「含子域」的语法糖，语义与裸域等价
  if (rule.startsWith('*.')) rule = rule.slice(2)

  if (rule.length === 0) return {ok: false, error: `"${input.trim()}" has no host`}
  if (IPV4.test(rule)) {
    if (!rule.split('.').every((part) => Number(part) <= 255)) {
      return {ok: false, error: `invalid IPv4 "${input.trim()}"`}
    }
  } else if (!HOST_LABEL.test(rule)) {
    return {ok: false, error: `"${input.trim()}" is not a valid hostname`}
  }
  return {ok: true, rule}
}

export type NormalizeAllOk = {ok: true; rules: readonly string[]}
export type NormalizeAllErr = {ok: false; errors: readonly string[]}

/** 归一整份名单（textarea 每行一条）；空行跳过；任一行非法则整体失败并列出所有错误。 */
export function normalizeDomainRules(text: string): NormalizeAllOk | NormalizeAllErr {
  const rules: string[] = []
  const errors: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const result = normalizeHostRule(line)
    if (result.ok) rules.push(result.rule)
    else errors.push(result.error)
  }
  return errors.length > 0 ? {ok: false, errors} : {ok: true, rules}
}

/** 点边界后缀匹配：example.com 命中自身与 a.b.example.com，不命中 notexample.com。 */
export function hostMatchesRule(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`)
}

export function isUrlAllowed(url: string, rules: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'chrome-extension:') return false
  const host = parsed.hostname.toLowerCase()
  if (host.length === 0) return false
  return rules.some((rule) => hostMatchesRule(host, rule))
}
