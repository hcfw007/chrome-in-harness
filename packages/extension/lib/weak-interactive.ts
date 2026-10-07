/**
 * 弱交互节点检测（纯逻辑，零 chrome.* 依赖）。
 * 背景：React 等框架把 click 监听代理到根节点，AX 树的 clickable 标记不到
 * 具体 div/li/span 上（语言下拉项这类自定义控件因此拿不到 ref）。
 * 方案：页面内扫一遍 computed cursor:pointer / onclick 元素（文档序 + 序号 + 标签），
 * 再与 CDP DOM.getDocument（同为文档序）的元素列表按序号对齐，得到 backendDOMNodeId。
 * 任何一步失败都降级为「无弱交互候选」，只损失补 ref 能力，不影响快照主流程。
 */

export interface WeakCandidate {
  /** 全文档元素序号（querySelectorAll('*') 的下标）。 */
  readonly index: number
  readonly tag: string
  readonly text: string
}

export interface WeakInfo {
  readonly tag: string
  readonly text: string
}

const WEAK_SCAN_LIMIT = 120

/**
 * 页面内执行的只读扫描脚本：收集 cursor:pointer 或带 onclick 属性、
 * 且不是原生交互元素的自定义控件候选。文档序遍历保证与 DOM.getDocument 对齐。
 */
export function buildWeakScanScript(limit = WEAK_SCAN_LIMIT): string {
  return `(() => {
    const NATIVE = new Set(['a','button','input','select','textarea','label','option','summary','video','audio'])
    const POPUP = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],dialog[open]'
    const hits = []
    let index = 0
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase()
      if (!NATIVE.has(tag)) {
        let weak = false
        try {
          if (el.onclick !== null) weak = true
          else if (getComputedStyle(el).cursor === 'pointer') weak = true
        } catch {}
        if (weak) {
          // 弹出层内的候选拔宽：允许带 role 祖先（下拉项常包在 dialog/listbox 里）；
          // 弹出层外维持旧排除规则（a/button/[role] 祖先不算自定义控件）
          const inPopup = !!el.closest(POPUP)
          if (inPopup || !el.closest('a,button,[role]')) {
            const rect = el.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              hits.push({index, tag, text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80)})
            }
          }
        }
      }
      index += 1
    }
    return hits.slice(0, ${limit})
  })()`
}

export function parseWeakScanResult(raw: unknown): readonly WeakCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: WeakCandidate[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record['index'] !== 'number' || typeof record['tag'] !== 'string') continue
    out.push({
      index: record['index'],
      tag: record['tag'].toLowerCase(),
      text: typeof record['text'] === 'string' ? record['text'] : '',
    })
  }
  return out
}

export interface FlatDomElement {
  readonly backendNodeId: number
  /** 小写标签名，如 div / li。 */
  readonly tag: string
}

/** 前序遍历 DOM.getDocument 的节点树，抽出元素节点（与 querySelectorAll('*') 同为文档序）。 */
export function flattenDomElements(root: unknown): readonly FlatDomElement[] {
  const out: FlatDomElement[] = []
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (typeof record['backendNodeId'] === 'number') {
      const nodeName = typeof record['nodeName'] === 'string' ? record['nodeName'] : ''
      if (nodeName.length > 0 && nodeName === nodeName.toUpperCase()) {
        // DOM.getDocument 的元素节点 nodeName 是大写标签（html、#text 之类非元素除外）
        out.push({backendNodeId: record['backendNodeId'], tag: nodeName.toLowerCase()})
      }
    }
    if (Array.isArray(record['children'])) {
      for (const child of record['children']) visit(child)
    }
    // shadow root（pierce 模式挂在 shadowRoots 上）同样按文档序
    if (Array.isArray(record['shadowRoots'])) {
      for (const shadow of record['shadowRoots']) visit(shadow)
    }
  }
  visit(root)
  return out
}

/**
 * 按文档序号把页面扫描候选对齐到 backendNodeId；序号越界或标签不符则丢弃该候选
 * （iframe 内容两侧行为不同，宁可漏掉也不能错绑）。
 */
export function mapWeakCandidates(
  elements: readonly FlatDomElement[],
  candidates: readonly WeakCandidate[],
): ReadonlyMap<number, WeakInfo> {
  const map = new Map<number, WeakInfo>()
  for (const candidate of candidates) {
    const element = elements[candidate.index]
    if (element === undefined || element.tag !== candidate.tag) continue
    if (!map.has(element.backendNodeId)) {
      map.set(element.backendNodeId, {tag: candidate.tag, text: candidate.text})
    }
  }
  return map
}
