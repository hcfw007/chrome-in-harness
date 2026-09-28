/** CDP 高层操作：每个函数对应一条（组）协议命令，全部经 lib/cdp.ts 的会话管理。 */

import {parseAxNodes} from './ax-types'
import type {AxNode} from './ax-types'
import {send, waitForEvent} from './cdp'

/** 每个 debugger 会话 enable 一次的 domain 集合（SW 内存级）。 */
const enabledDomains = new Map<number, Set<string>>()

async function enableOnce(tabId: number, domain: string, command: string): Promise<void> {
  let domains = enabledDomains.get(tabId)
  if (domains === undefined) {
    domains = new Set<string>()
    enabledDomains.set(tabId, domains)
  }
  if (!domains.has(domain)) {
    await send(tabId, command)
    domains.add(domain)
  }
}

export async function getFullAxTree(tabId: number): Promise<AxNode[]> {
  await enableOnce(tabId, 'Accessibility', 'Accessibility.enable')
  const result = await send<{nodes?: unknown}>(tabId, 'Accessibility.getFullAXTree')
  return parseAxNodes(result.nodes)
}

/** 导航并等待 load 事件；超时返回 loaded=false（内容可能不完整但不报错）。 */
export async function navigateAndWaitLoad(
  tabId: number,
  url: string,
  timeoutMs = 8000,
): Promise<{loaded: boolean}> {
  await enableOnce(tabId, 'Page', 'Page.enable')
  const [loadEvent] = await Promise.all([
    waitForEvent(tabId, 'Page.loadEventFired', timeoutMs),
    send(tabId, 'Page.navigate', {url}),
  ])
  return {loaded: loadEvent !== null}
}

export async function getTabTitle(tabId: number): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  return tab?.title
}

export async function scrollIntoViewIfNeeded(tabId: number, backendNodeId: number): Promise<void> {
  await send(tabId, 'DOM.scrollIntoViewIfNeeded', {backendNodeId})
}

interface BoxModelResult {
  readonly model?: {readonly content?: readonly number[]}
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** 元素 content quad 的中心点；OOPIF/已失效节点在此报错，由调用方映射 stale。 */
export async function elementCenter(
  tabId: number,
  backendNodeId: number,
): Promise<{x: number; y: number}> {
  const result = await send<BoxModelResult>(tabId, 'DOM.getBoxModel', {backendNodeId})
  const quad = result.model?.content
  if (quad === undefined || quad.length < 8) {
    throw new Error('element has no box model (it may live in an out-of-process frame or be display:none)')
  }
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i + 1 < quad.length; i += 2) {
    const x = quad[i]
    const y = quad[i + 1]
    if (x !== undefined && y !== undefined) {
      xs.push(x)
      ys.push(y)
    }
  }
  if (xs.length === 0) throw new Error('element box model is empty')
  return {x: average(xs), y: average(ys)}
}

export async function dispatchClick(tabId: number, x: number, y: number): Promise<void> {
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1})
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1})
}

export async function dispatchHover(tabId: number, x: number, y: number): Promise<void> {
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mouseMoved', x, y})
}

export async function dispatchWheel(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mouseWheel', x, y, deltaX, deltaY})
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await send(tabId, 'Input.insertText', {text})
}

export async function pressEnter(tabId: number): Promise<void> {
  const base = {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13}
  await send(tabId, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', ...base})
  await send(tabId, 'Input.dispatchKeyEvent', {type: 'keyUp', ...base})
}

export async function captureScreenshot(tabId: number): Promise<string> {
  const result = await send<{data?: string}>(tabId, 'Page.captureScreenshot', {format: 'png'})
  if (result.data === undefined) throw new Error('screenshot returned no data')
  return result.data
}

/** 视口中心（滚轮默认原点）；evaluate 失败时退回保守默认，滚轮坐标越界会被浏览器 clamp。 */
export async function viewportCenter(tabId: number): Promise<{x: number; y: number}> {
  const result = await send<{result?: {value?: unknown}}>(tabId, 'Runtime.evaluate', {
    expression: 'JSON.stringify({w: window.innerWidth, h: window.innerHeight})',
    returnByValue: true,
  })
  const raw = result.result?.value
  if (typeof raw === 'string') {
    try {
      const dims = JSON.parse(raw) as {w?: number; h?: number}
      if (typeof dims.w === 'number' && typeof dims.h === 'number' && dims.w > 0 && dims.h > 0) {
        return {x: dims.w / 2, y: dims.h / 2}
      }
    } catch {
      // fall through to default
    }
  }
  return {x: 400, y: 400}
}
