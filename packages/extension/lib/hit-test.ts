/**
 * click_at 命中反馈（纯逻辑，零 chrome.* 依赖）。
 * 点击前在页面内按坐标做 hit-test，告诉调用方「这一击会落在哪个元素上」，
 * 让坐标偏移 / 被遮挡 / 点到容器空白处这几类失败可以自证。
 */
import {scriptNumber} from './script-number'

export interface HitInfo {
  readonly tag: string
  readonly id?: string
  readonly role?: string
  readonly text: string
  readonly rect: {readonly x: number; readonly y: number; readonly width: number; readonly height: number}
  /** 命中元素最近的可交互祖先（含自身）；undefined = 落点附近没有可点控件。 */
  readonly interactive?: {readonly tag: string; readonly role?: string; readonly text: string}
  /** 命中的是 iframe：坐标落进了子 frame，页面内 handler 收不到，需在 frame 内重算坐标。 */
  readonly inIframe?: boolean
}

const TEXT_MAX = 80

/** 页面内只读脚本：elementFromPoint（穿透开放 shadow root）+ 可交互祖先 + rect。 */
export function buildHitTestScript(rawX: number, rawY: number): string {
  const x = scriptNumber('x', rawX)
  const y = scriptNumber('y', rawY)
  return `(() => {
    const clip = (s) => (s || '').trim().replace(/\\s+/g, ' ').slice(0, ${TEXT_MAX})
    let el = document.elementFromPoint(${x}, ${y})
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(${x}, ${y})
      if (!inner || inner === el) break
      el = inner
    }
    // 落在 html/body 上 = 空白区域：不回传整页文本，按无命中处理
    if (!el || el === document.documentElement || el === document.body) return null
    const r = el.getBoundingClientRect()
    const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role],[onclick],[tabindex]'
    let target = el.closest(INTERACTIVE)
    if (!target) {
      for (let cur = el; cur; cur = cur.parentElement) {
        if (getComputedStyle(cur).cursor === 'pointer') { target = cur; break }
      }
    }
    const info = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      role: el.getAttribute('role') || undefined,
      text: clip(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value')),
      rect: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)},
      inIframe: el.tagName === 'IFRAME' || el.tagName === 'FRAME' || undefined,
    }
    if (target) {
      info.interactive = {
        tag: target.tagName.toLowerCase(),
        role: target.getAttribute('role') || undefined,
        text: clip(target.innerText || target.textContent || target.getAttribute('aria-label')),
      }
    }
    return info
  })()`
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 校验页面回传；形状不对一律视为「无命中」，不让反馈本身制造错误。 */
export function parseHitTestResult(raw: unknown): HitInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const tag = str(record['tag'])
  if (tag === undefined) return null
  const rect = (typeof record['rect'] === 'object' && record['rect'] !== null ? record['rect'] : {}) as Record<string, unknown>
  const id = str(record['id'])
  const role = str(record['role'])
  const interactiveRaw = record['interactive']
  let interactive: HitInfo['interactive']
  if (typeof interactiveRaw === 'object' && interactiveRaw !== null) {
    const ir = interactiveRaw as Record<string, unknown>
    const itag = str(ir['tag'])
    if (itag !== undefined) {
      const irole = str(ir['role'])
      interactive = {tag: itag, ...(irole !== undefined ? {role: irole} : {}), text: str(ir['text']) ?? ''}
    }
  }
  return {
    tag,
    ...(id !== undefined ? {id} : {}),
    ...(role !== undefined ? {role} : {}),
    text: str(record['text']) ?? '',
    rect: {x: num(rect['x']), y: num(rect['y']), width: num(rect['width']), height: num(rect['height'])},
    ...(interactive !== undefined ? {interactive} : {}),
    ...(record['inIframe'] === true ? {inIframe: true} : {}),
  }
}
