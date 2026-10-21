/**
 * scroll_to 的页面内定位与回执（纯逻辑，零 chrome.* 依赖）。
 * selector / text 两种定位在页面内完成并 scrollIntoView；ref 定位走 CDP，回执共用 DESCRIBE_ELEMENT。
 */

export interface ScrollToReceipt {
  readonly rect: {readonly x: number; readonly y: number; readonly width: number; readonly height: number}
  readonly inViewport: boolean
  readonly tag?: string
  readonly text?: string
}

/** 页面内：元素 → {rect, inViewport, tag, text}。中心点落在视口内才算 inViewport。 */
export const DESCRIBE_ELEMENT = `function (el) {
  const r = el.getBoundingClientRect()
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2
  return {
    rect: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)},
    inViewport: r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
  }
}`

/**
 * 页面内脚本：按 selector 或可见文本找元素 → scrollIntoView(center) → 回执；找不到返回 null。
 * 文本定位取文档序首个「直接子文本节点包含该串」的可见元素（避免命中 body 这类祖先）。
 */
/** 文本定位上溯的交互祖先：原生控件与常见 ARIA 控件角色（不含 [role] 泛匹配，避免上溯到 region/row）。 */
export const TEXT_CONTROL_SELECTOR = [
  'button', 'a[href]', 'label', 'summary', 'select', 'option',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="option"]',
  '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="treeitem"]',
].join(',')

export interface PageLocator {
  readonly selector?: string
  readonly text?: string
}

/** 页面内表达式：按 selector 或可见文本找到元素（找不到为 null）。probe / get_html 共用。 */
export function buildFindElementExpression(target: PageLocator): string {
  if (target.selector !== undefined) return `document.querySelector(${JSON.stringify(target.selector)})`
  // 文本常包在控件内部的 span 里（antd 的 <button><span>导 出</span></button>）：
  // 命中后上溯到最近的交互祖先，回执描述的才是用户会点的那个元素
  return `(() => {
    const needle = ${JSON.stringify(target.text ?? '')}
    const CONTROL = ${JSON.stringify(TEXT_CONTROL_SELECTOR)}
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.includes(needle)) continue
      const el = node.parentElement
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return el.closest(CONTROL) || el
    }
    return null
  })()`
}

export function buildScrollToScript(target: PageLocator): string {
  return `(() => {
    const el = ${buildFindElementExpression(target)}
    if (!el) return null
    el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'})
    return (${DESCRIBE_ELEMENT})(el)
  })()`
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function parseScrollToReceipt(raw: unknown): ScrollToReceipt | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const rectRaw = record['rect']
  if (typeof rectRaw !== 'object' || rectRaw === null) return null
  const rect = rectRaw as Record<string, unknown>
  return {
    rect: {x: num(rect['x']), y: num(rect['y']), width: num(rect['width']), height: num(rect['height'])},
    inViewport: record['inViewport'] === true,
    ...(typeof record['tag'] === 'string' ? {tag: record['tag']} : {}),
    ...(typeof record['text'] === 'string' && record['text'].length > 0 ? {text: record['text']} : {}),
  }
}
