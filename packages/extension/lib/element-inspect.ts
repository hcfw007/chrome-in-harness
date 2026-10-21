/**
 * probe / get_html 的页面内描述函数与回执解析（纯逻辑，零 chrome.* 依赖）。
 * 描述函数以 `function (el, ...)` 形式给出：selector/text 模式在页面内找到元素后调用，
 * ref 模式经 Runtime.callFunctionOn 以 this 绑定元素调用（见 describeNodeRect）。
 */
import {scriptNumber} from './script-number'
import {buildFindElementExpression} from './scroll-locate'
import type {PageLocator} from './scroll-locate'

/** probe 回传的白名单属性：足以定位与判断状态，不含 value/style 等可能很长或敏感的字段。 */
const ATTR_ALLOW = ['id', 'class', 'role', 'name', 'type', 'href', 'placeholder', 'title', 'alt', 'disabled', 'data-testid']
const ATTR_MAX = 120

export const PROBE_ELEMENT = `function (el) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2
  const allow = ${JSON.stringify(ATTR_ALLOW)}
  const attrs = {}
  for (const a of el.attributes) {
    if (allow.includes(a.name) || a.name.startsWith('aria-')) attrs[a.name] = String(a.value).slice(0, ${ATTR_MAX})
  }
  return {
    exists: true,
    visible,
    inViewport: visible && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight,
    rect: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)},
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200),
    attrs,
  }
}`

/** outerHTML 截断到 maxChars；length 报原始长度。 */
export function buildHtmlFunction(rawMaxChars: number): string {
  const maxChars = scriptNumber('maxChars', rawMaxChars)
  return `function (el) {
  const html = el.outerHTML || ''
  return {html: html.slice(0, ${maxChars}), length: html.length, truncated: html.length > ${maxChars}}
}`
}

/** selector/text 模式的 probe 脚本：找不到返回 {exists:false}；selector 模式额外报匹配总数。 */
export function buildProbeScript(target: PageLocator): string {
  const count = target.selector !== undefined ? `document.querySelectorAll(${JSON.stringify(target.selector)}).length` : 'undefined'
  return `(() => {
    const el = ${buildFindElementExpression(target)}
    const count = ${count}
    if (!el) return count === undefined ? {exists: false} : {exists: false, count}
    const info = (${PROBE_ELEMENT})(el)
    return count === undefined ? info : {...info, count}
  })()`
}

/** selector/text 模式的 get_html 脚本：找不到返回 null。 */
export function buildGetHtmlScript(target: PageLocator, maxChars: number): string {
  return `(() => {
    const el = ${buildFindElementExpression(target)}
    return el ? (${buildHtmlFunction(maxChars)})(el) : null
  })()`
}

export interface ProbeInfo {
  readonly exists: boolean
  readonly count?: number
  readonly visible?: boolean
  readonly inViewport?: boolean
  readonly rect?: {readonly x: number; readonly y: number; readonly width: number; readonly height: number}
  readonly tag?: string
  readonly text?: string
  readonly attrs?: Readonly<Record<string, string>>
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function parseProbeResult(raw: unknown): ProbeInfo {
  if (typeof raw !== 'object' || raw === null) return {exists: false}
  const record = raw as Record<string, unknown>
  const count = typeof record['count'] === 'number' ? {count: record['count']} : {}
  if (record['exists'] !== true) return {exists: false, ...count}
  const rect = (typeof record['rect'] === 'object' && record['rect'] !== null ? record['rect'] : {}) as Record<string, unknown>
  const attrs: Record<string, string> = {}
  if (typeof record['attrs'] === 'object' && record['attrs'] !== null) {
    for (const [key, value] of Object.entries(record['attrs'] as Record<string, unknown>)) {
      if (typeof value === 'string') attrs[key] = value
    }
  }
  return {
    exists: true,
    ...count,
    visible: record['visible'] === true,
    inViewport: record['inViewport'] === true,
    rect: {x: num(rect['x']), y: num(rect['y']), width: num(rect['width']), height: num(rect['height'])},
    ...(typeof record['tag'] === 'string' ? {tag: record['tag']} : {}),
    text: typeof record['text'] === 'string' ? record['text'] : '',
    attrs,
  }
}

export interface HtmlInfo {
  readonly html: string
  readonly length: number
  readonly truncated: boolean
}

export function parseHtmlResult(raw: unknown): HtmlInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record['html'] !== 'string') return null
  return {
    html: record['html'],
    length: typeof record['length'] === 'number' ? record['length'] : record['html'].length,
    truncated: record['truncated'] === true,
  }
}
