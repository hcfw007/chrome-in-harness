/**
 * select_option 的页面内脚本（纯逻辑，零 chrome.* 依赖）。
 * 原生 <select>：原型 value setter + input/change（React 受控也能收到）。
 * 自定义下拉（antd / Element / ARIA listbox）：在可见选项里按文本匹配，回执中心点供 CDP 真实点击。
 * antd 虚拟列表的可见选项不带 role（role="option" 在 0 尺寸的隐藏无障碍列表上），
 * 所以候选同时按 role 与常见组件库 class 匹配，并只认有尺寸的元素。
 */

export const OPTION_CANDIDATE_SELECTOR = [
  '[role="option"]',
  '.ant-select-item-option',
  '.ant-cascader-menu-item',
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="treeitem"]',
].join(',')

/** 回执里最多列出的可见选项数（找不到目标时给调用方参考）。 */
const MAX_LISTED_OPTIONS = 20

/**
 * this 绑定元素的函数：原生 <select> 按文本选中。
 * 先精确匹配（trim 后相等），再退到包含匹配；非 <select> 返回 not-native。
 */
export function buildNativeSelectFn(text: string): string {
  return `function (el) {
    if (!el || el.tagName !== 'SELECT') return {kind: 'not-native'}
    const needle = ${JSON.stringify(text)}
    const options = Array.from(el.options)
    const label = (o) => (o.text || '').trim()
    const option = options.find((o) => label(o) === needle) || options.find((o) => label(o).includes(needle))
    if (!option) return {kind: 'none', options: options.slice(0, ${MAX_LISTED_OPTIONS}).map(label)}
    if (option.disabled) return {kind: 'disabled', text: label(option)}
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
    if (desc && desc.set) desc.set.call(el, option.value)
    else el.value = option.value
    el.dispatchEvent(new Event('input', {bubbles: true}))
    el.dispatchEvent(new Event('change', {bubbles: true}))
    const picked = el.selectedOptions && el.selectedOptions[0]
    return {kind: 'ok', text: picked ? label(picked) : label(option)}
  }`
}

/**
 * 页面内表达式：在可见的选项候选里找文本匹配项，滚进视野并回执中心点。
 * 精确匹配优先于包含匹配；禁用项（aria-disabled / *-disabled class）不点。
 */
export function buildFindOptionScript(text: string): string {
  return `(() => {
    const needle = ${JSON.stringify(text)}
    const clickable = ${IS_CLICKABLE_FN}
    const visible = []
    for (const el of document.querySelectorAll(${JSON.stringify(OPTION_CANDIDATE_SELECTOR)})) {
      // 嵌套命中（role=option 里还有 .ant-select-item-option）只留最外层
      if (el.parentElement && el.parentElement.closest(${JSON.stringify(OPTION_CANDIDATE_SELECTOR)})) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      // pointer-events 会继承：关闭动画中的下拉层（pointer-events:none）里的选项在这里被排除
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue
      const label = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ')
      visible.push({el, label})
    }
    const pick = visible.find((o) => o.label === needle) || visible.find((o) => o.label.includes(needle))
    if (!pick) return {kind: 'none', count: visible.length, options: visible.slice(0, ${MAX_LISTED_OPTIONS}).map((o) => o.label)}
    const el = pick.el
    const disabled = el.getAttribute('aria-disabled') === 'true' || /(^|[\\s-])disabled(\\s|$)/.test(el.className || '')
    if (disabled) return {kind: 'disabled', text: pick.label}
    el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'})
    // 滚动后再做命中测试：被遮挡的选项点上去会落到别的元素
    if (!clickable(el)) return {kind: 'covered', text: pick.label}
    const r = el.getBoundingClientRect()
    return {kind: 'found', text: pick.label, x: r.x + r.width / 2, y: r.y + r.height / 2}
  })()`
}

/**
 * 页面内函数体：选项能否真正接收点击——有尺寸、未隐藏、不在 pointer-events:none 的层里，
 * 且中心点命中它自己（不被遮挡）。antd 下拉关闭动画期间选项仍可见，但层已是 pointer-events:none，
 * 此时点上去不会生效，必须当作「下拉没开」处理。
 */
const IS_CLICKABLE_FN = `function (el) {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return !!hit && (hit === el || el.contains(hit))
}`

/** 页面内表达式：当前是否已有可点击的选项（下拉已展开时不再点触发器，避免把它关掉）。 */
export const HAS_VISIBLE_OPTIONS = `(() => {
  const clickable = ${IS_CLICKABLE_FN}
  for (const el of document.querySelectorAll(${JSON.stringify(OPTION_CANDIDATE_SELECTOR)})) {
    if (clickable(el)) return true
  }
  return false
})()`

/** 页面内表达式：是否有「可见但不可点」的选项（下拉正在关闭的动画中）。 */
export const HAS_CLOSING_OPTIONS = `(() => {
  const clickable = ${IS_CLICKABLE_FN}
  for (const el of document.querySelectorAll(${JSON.stringify(OPTION_CANDIDATE_SELECTOR)})) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && !clickable(el)) return true
  }
  return false
})()`

/**
 * this 绑定元素的函数：读触发器上当前显示的值，用于选完后核对。
 * 先上溯到组件根（antd / Element / combobox），读其可见文本；没有文本时读内部 input 的值。
 */
export const READ_SELECT_DISPLAY_FN = `function (el) {
  if (!el) return ''
  if (el.tagName === 'SELECT') {
    const picked = el.selectedOptions && el.selectedOptions[0]
    return picked ? (picked.text || '').trim() : ''
  }
  const host = el.closest('.ant-select, .ant-cascader, .el-select, .el-cascader') || el
  // antd 的选择框里同时有选中项与搜索输入的镜像文本，整块 innerText 会重复；优先读选中项本身
  const picked = host.querySelectorAll && host.querySelectorAll('.ant-select-selection-item, .ant-select-selection-item-content')
  if (picked && picked.length > 0) {
    return Array.from(picked).map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean).join(', ')
  }
  const text = (host.innerText || '').trim().replace(/\\s+/g, ' ')
  if (text) return text
  const input = host.tagName === 'INPUT' ? host : host.querySelector && host.querySelector('input')
  return input ? String(input.value || '') : ''
}`

export type NativeSelectReceipt =
  | {readonly kind: 'not-native'}
  | {readonly kind: 'ok'; readonly text: string}
  | {readonly kind: 'disabled'; readonly text: string}
  | {readonly kind: 'none'; readonly options: readonly string[]}

export type FindOptionReceipt =
  | {readonly kind: 'found'; readonly text: string; readonly x: number; readonly y: number}
  | {readonly kind: 'disabled'; readonly text: string}
  | {readonly kind: 'covered'; readonly text: string}
  | {readonly kind: 'none'; readonly count: number; readonly options: readonly string[]}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 页面回执是不可信输入：结构不对一律按「页面没给出可用结果」处理，由调用方报错。 */
export function parseNativeSelectReceipt(raw: unknown): NativeSelectReceipt | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = typeof r['text'] === 'string' ? r['text'] : ''
  switch (r['kind']) {
    case 'not-native': return {kind: 'not-native'}
    case 'ok': return {kind: 'ok', text}
    case 'disabled': return {kind: 'disabled', text}
    case 'none': return {kind: 'none', options: strings(r['options'])}
    default: return null
  }
}

export function parseFindOptionReceipt(raw: unknown): FindOptionReceipt | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = typeof r['text'] === 'string' ? r['text'] : ''
  if (r['kind'] === 'found') {
    const x = finite(r['x'])
    const y = finite(r['y'])
    return x === undefined || y === undefined ? null : {kind: 'found', text, x, y}
  }
  if (r['kind'] === 'disabled') return {kind: 'disabled', text}
  if (r['kind'] === 'covered') return {kind: 'covered', text}
  if (r['kind'] === 'none') return {kind: 'none', count: finite(r['count']) ?? 0, options: strings(r['options'])}
  return null
}
