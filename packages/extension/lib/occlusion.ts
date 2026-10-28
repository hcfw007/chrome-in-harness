/**
 * ref 点击前的遮挡检查（纯逻辑，零 chrome.* 依赖）。
 *
 * 弹窗外的元素被遮罩盖住时，按元素中心点派发的真实点击会落在遮罩上——antd 默认点遮罩
 * 就关闭 Modal，模型只看到「点了没反应」和随后一串失效 ref。点击前在页面内对
 * 同一坐标做 elementFromPoint：命中目标自身或其后代（含 label 关联的控件、开放 shadow root）
 * 才算可点，否则报出盖住它的元素，不点下去。
 */
import {scriptNumber} from './script-number'

const TEXT_MAX = 60

/**
 * this 绑定 ref 指向的节点（文本节点按其父元素算）。坐标由调用方传入（与派发点击的坐标完全一致），
 * 页面里只做比较、不改任何状态。
 */
export function buildOcclusionFn(rawX: number, rawY: number): string {
  const x = scriptNumber('x', rawX)
  const y = scriptNumber('y', rawY)
  return `function () {
    const clip = (s) => (s || '').trim().replace(/\\s+/g, ' ').slice(0, ${TEXT_MAX})
    const describe = (hit) => {
      const cls = typeof hit.className === 'string' ? hit.className : ''
      return {
        kind: 'covered',
        tag: hit.tagName.toLowerCase(),
        id: hit.id || undefined,
        cls: clip(cls) || undefined,
        text: clip(hit.innerText || hit.textContent) || undefined,
      }
    }
    const pierce = (doc, px, py) => {
      let hit = doc.elementFromPoint(px, py)
      while (hit && hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(px, py)
        if (!inner || inner === hit) break
        hit = inner
      }
      return hit
    }
    const self = this.nodeType === 1 ? this : this.parentElement
    if (!self) return {kind: 'unknown'}
    // 坐标是顶层视口坐标。目标在同源 iframe 里时，从顶层逐层确认该点命中的是那层 iframe
    // （否则点击会落到盖在上面的另一个 iframe / 元素），再换算成目标文档内坐标
    const frames = []
    let win = self.ownerDocument.defaultView
    while (win) {
      let frame = null
      try { frame = win.frameElement } catch (err) { frame = null }
      if (!frame) break
      frames.push(frame)
      win = frame.ownerDocument.defaultView
    }
    // 外层是跨域 frame：拿不到顶层坐标系，无法判定（放行）
    if (win && win.parent !== win) return {kind: 'unknown'}
    let x = ${x}, y = ${y}
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i]
      const frameHit = pierce(frame.ownerDocument, x, y)
      if (!frameHit) return {kind: 'outside'}
      if (frameHit !== frame) return describe(frameHit)
      const rect = frame.getBoundingClientRect()
      const style = frame.ownerDocument.defaultView.getComputedStyle(frame)
      x -= rect.left + frame.clientLeft + (parseFloat(style.paddingLeft) || 0)
      y -= rect.top + frame.clientTop + (parseFloat(style.paddingTop) || 0)
    }
    const hit = pierce(self.ownerDocument, x, y)
    if (!hit) return {kind: 'outside'}
    // 命中目标自身或其后代（按钮里的图标/文字 span）= 点击会到达目标
    if (self === hit || self.contains(hit)) return {kind: 'clear'}
    // 目标在开放 shadow root 里时，elementFromPoint 在宿主层返回的是宿主
    const root = self.getRootNode && self.getRootNode()
    if (root && root.host && (root.host === hit || root.host.contains(hit))) return {kind: 'clear'}
    // <label> 与其控件互通：点 label 等于点控件（antd Checkbox / Radio 的真实 input 常被 label 盖住）
    const label = hit.closest && hit.closest('label')
    if (label && label.control && (label.control === self || self.contains(label.control))) return {kind: 'clear'}
    // 组件库常把真实 input 藏在装饰层下（选择框占位符、自定义开关）：同一控件根内的命中仍会把点击交给该控件
    const CONTROL_ROOT = '.ant-select,.ant-picker,.ant-cascader,.ant-checkbox-wrapper,.ant-radio-wrapper,.ant-switch,.el-select,.el-input,.el-checkbox,.el-radio,[role="combobox"]'
    const controlRoot = self.closest && self.closest(CONTROL_ROOT)
    if (controlRoot && controlRoot.contains(hit)) return {kind: 'clear'}
    // 其余情况（遮罩、浮层、命中目标的祖先空白处）：真实点击落不到目标上
    return describe(hit)
  }`
}

export type OcclusionResult =
  | {readonly kind: 'clear'}
  | {readonly kind: 'outside'}
  | {readonly kind: 'unknown'}
  | {readonly kind: 'covered'; readonly by: string}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 页面回执不可信：结构不对按 unknown 处理（调用方放行，不让检查本身制造失败）。 */
export function parseOcclusion(raw: unknown): OcclusionResult {
  if (typeof raw !== 'object' || raw === null) return {kind: 'unknown'}
  const r = raw as Record<string, unknown>
  if (r['kind'] === 'clear') return {kind: 'clear'}
  if (r['kind'] === 'outside') return {kind: 'outside'}
  if (r['kind'] !== 'covered') return {kind: 'unknown'}
  const tag = str(r['tag']) ?? '?'
  const id = str(r['id'])
  const cls = str(r['cls'])
  const text = str(r['text'])
  const by =
    `<${tag}${id !== undefined ? `#${id}` : ''}${cls !== undefined ? ` class="${cls}"` : ''}>` +
    (text !== undefined ? ` "${text}"` : '')
  return {kind: 'covered', by}
}
