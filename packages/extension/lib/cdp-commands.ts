/** CDP 高层操作：每个函数对应一条（组）协议命令，全部经 lib/cdp.ts 的会话管理。 */

import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'

import {parseAxNodes} from './ax-types'
import type {AxNode} from './ax-types'
import {send, subscribeEvents, unsubscribeEvents, waitForEvent} from './cdp'
import {consoleBuffer} from './console-buffer'
import type {ConsoleLevel} from './console-buffer'
import type {InputModifier, KeyDispatch} from './keymap'
import {keyDownText, modifierBitmask} from './keymap'
import {networkBuffer} from './network-buffer'

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

/** 执行表达式并取 JSON 值；页面内异常透出为普通 Error。 */
export async function evaluateJson<T = unknown>(tabId: number, expression: string): Promise<T> {
  const result = await send<{
    result?: {value?: unknown}
    exceptionDetails?: {text?: string; exception?: {description?: string}}
  }>(tabId, 'Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true})
  const details = result.exceptionDetails
  if (details !== undefined) {
    throw new Error(details.exception?.description ?? details.text ?? 'evaluate failed')
  }
  return result.result?.value as T
}

/** console 级别归一：CDP type 到三档。 */
function consoleLevel(cdpType: string): ConsoleLevel {
  if (cdpType === 'error') return 'error'
  if (cdpType === 'warning') return 'warning'
  return 'info'
}

function serializeArgs(args: unknown): string {
  if (!Array.isArray(args)) return ''
  const parts = args.map((raw) => {
    const arg = raw as {value?: unknown; description?: string; type?: string}
    if (arg.description !== undefined) return arg.description
    if (typeof arg.value === 'string') return arg.value
    if (arg.value !== undefined) return JSON.stringify(arg.value)
    return arg.type ?? 'undefined'
  })
  return parts.join(' ')
}

/** 每个会话注册一次 console / network 采集订阅（幂等）。 */
const collectors = new Map<number, true>()

/** 清 enable 缓存（detach 后重 attach 需重新 enable）。 */
export function forgetDomains(tabId: number): void {
  enabledDomains.delete(tabId)
}

function attachSubscribers(tabId: number): void {
  subscribeEvents(tabId, 'Runtime.consoleAPICalled', (raw) => {
    const params = raw as {type?: string; args?: unknown; timestamp?: number}
    consoleBuffer.append(tabId, {
      level: consoleLevel(params.type ?? 'log'),
      text: serializeArgs(params.args).slice(0, 500),
      timestamp: params.timestamp ?? Date.now(),
    })
  })
  subscribeEvents(tabId, 'Runtime.exceptionThrown', (raw) => {
    const params = raw as {
      timestamp?: number
      exceptionDetails?: {text?: string; exception?: {description?: string}; value?: string}
    }
    const text = params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.value ?? params.exceptionDetails?.text ?? 'uncaught exception'
    consoleBuffer.append(tabId, {level: 'error', text: text.slice(0, 500), timestamp: params.timestamp ?? Date.now()})
  })
  subscribeEvents(tabId, 'Network.requestWillBeSent', (raw) => {
    const params = raw as {
      requestId?: string
      timestamp?: number
      request?: {url?: string; method?: string}
    }
    if (params.requestId === undefined || params.request?.url === undefined) return
    networkBuffer.recordRequest(
      tabId,
      params.requestId,
      params.request.method ?? 'GET',
      params.request.url,
      params.timestamp ?? Date.now(),
    )
  })
  subscribeEvents(tabId, 'Network.responseReceived', (raw) => {
    const params = raw as {requestId?: string; response?: {status?: number; mimeType?: string}}
    if (params.requestId === undefined) return
    networkBuffer.recordResponse(tabId, params.requestId, params.response?.status ?? 0, params.response?.mimeType)
  })
  subscribeEvents(tabId, 'Network.loadingFailed', (raw) => {
    const params = raw as {requestId?: string; errorText?: string; canceled?: boolean}
    if (params.requestId === undefined) return
    const reason = params.canceled === true ? 'canceled' : params.errorText ?? 'failed'
    networkBuffer.recordFailure(tabId, params.requestId, reason)
  })
}

/**
 * 启动采集：订阅事件**并 enable 对应 CDP domain**。
 * enable 是必须的——CDP 在 domain 未 enable 时不派发事件，只订阅会得到空缓冲。
 * 幂等；attach 复用（含 SW 被杀后惰性重查）时也需调用，故按 tab 记忆。
 */
export function ensureCollectors(tabId: number): void {
  if (collectors.has(tabId)) return
  collectors.set(tabId, true)
  attachSubscribers(tabId)
  void Promise.all([
    enableOnce(tabId, 'Runtime', 'Runtime.enable'),
    enableOnce(tabId, 'Network', 'Network.enable'),
    enableOnce(tabId, 'Log', 'Log.enable'),
  ]).catch((error: unknown) => {
    console.warn('[cdp] enabling collectors failed:', error instanceof Error ? error.message : error)
    // 失败则撤销记忆，下次工具调用重试
    collectors.delete(tabId)
  })
}

/** 清采集注册（detach / tab 关闭时；下次 attach 会重新注册）。 */
export function dropCollectors(tabId: number): void {
  collectors.delete(tabId)
  forgetDomains(tabId)
}

export async function getFullAxTree(tabId: number): Promise<AxNode[]> {
  await enableOnce(tabId, 'Accessibility', 'Accessibility.enable')
  const result = await send<{nodes?: unknown}>(tabId, 'Accessibility.getFullAXTree')
  return parseAxNodes(result.nodes)
}

/** 导航等待策略：load 事件 / domcontentloaded(+500ms 静默) / networkidle(+500ms 静默)。 */
export type NavigateWaitUntil = 'load' | 'domcontentloaded' | 'networkidle'

const NAVIGATE_TIMEOUT_MS = 8_000
const SETTLE_MS = 500

/**
 * 导航并按策略等待；信号未到返回 loaded=false（内容可能不完整但不报错）。
 * domcontentloaded/networkidle 都带 500ms 静默期，让 SPA 的首波渲染落定。
 */
export async function navigateAndWait(
  tabId: number,
  url: string,
  waitUntil: NavigateWaitUntil = 'domcontentloaded',
): Promise<{loaded: boolean}> {
  await enableOnce(tabId, 'Page', 'Page.enable')
  if (waitUntil === 'load') {
    const [loadEvent] = await Promise.all([
      waitForEvent(tabId, 'Page.loadEventFired', NAVIGATE_TIMEOUT_MS),
      send(tabId, 'Page.navigate', {url}),
    ])
    return {loaded: loadEvent !== null}
  }

  await enableOnce(tabId, 'Network', 'Network.enable')

  if (waitUntil === 'domcontentloaded') {
    const [dclEvent] = await Promise.all([
      waitForEvent(tabId, 'Page.domContentEventFired', NAVIGATE_TIMEOUT_MS),
      send(tabId, 'Page.navigate', {url}),
    ])
    if (dclEvent === null) return {loaded: false}
    await sleep(SETTLE_MS)
    return {loaded: true}
  }

  // networkidle：DCL 后等「请求静默窗」——500ms 内无新请求即视为 idle。
  // 不做在途计数对账：重定向/SW 托管的请求可能没有配对的完成事件，计数会漂移卡死。
  const quiet = new RequestQuietTracker(tabId)
  try {
    const [dclEvent] = await Promise.all([
      waitForEvent(tabId, 'Page.domContentEventFired', NAVIGATE_TIMEOUT_MS),
      send(tabId, 'Page.navigate', {url}),
    ])
    if (dclEvent === null) return {loaded: false}
    const idle = await quiet.waitUntilQuiet(SETTLE_MS, NAVIGATE_TIMEOUT_MS + SETTLE_MS)
    return {loaded: idle}
  } finally {
    quiet.dispose()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 请求静默窗：记录最近一次新请求（排除重定向续发）的时间，静默 holdMs 即 idle。 */
class RequestQuietTracker {
  private lastRequestStart = Date.now()
  private readonly unsubscribers: Array<() => void> = []

  constructor(tabId: number) {
    const onRequest = (raw: unknown): void => {
      const params = raw as {redirectResponse?: unknown}
      // redirectResponse 存在 = 同一 requestId 的重定向续发，不算新请求
      if (params.redirectResponse !== undefined) return
      this.lastRequestStart = Date.now()
    }
    subscribeEvents(tabId, 'Network.requestWillBeSent', onRequest)
    this.unsubscribers.push(() => unsubscribeEvents(tabId, 'Network.requestWillBeSent', onRequest))
  }

  /** 连续 holdMs 无新请求 → true；totalTimeoutMs 内未达成 → false。 */
  async waitUntilQuiet(holdMs: number, totalTimeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + totalTimeoutMs
    while (Date.now() < deadline) {
      if (Date.now() - this.lastRequestStart >= holdMs) return true
      await sleep(50)
    }
    return false
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers.length = 0
  }
}

export async function getTabTitle(tabId: number): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  return tab?.title
}

/**
 * 让目标 tab 可交互：tab 激活到前台 + 所在窗口若最小化则恢复。
 * CDP `Input.*` 在两种情况下被静默丢弃（命令成功返回但页面收不到事件，
 * 表现为「点了没反应」）：
 * ① tab 在后台（visibility:hidden 不处理输入）；
 * ② 所在窗口最小化（实测 Chrome 154，前台 tab 也一样丢）。
 * 所有输入类工具在派发前调用此函数。
 */
export async function activateTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.active !== true) await chrome.tabs.update(tabId, {active: true})
    if (tab.windowId !== undefined) await restoreWindowIfNeeded(tab.windowId)
  } catch (error) {
    // 窗口恢复失败必须透传（否则输入静默失效），其余意外只告警不阻塞
    if (error instanceof Error && error.message.startsWith(`${TOOL_ERROR_CODES.WINDOW_NOT_INTERACTIVE}:`)) {
      throw error
    }
    console.warn('[cdp] activateTab failed:', error instanceof Error ? error.message : error)
  }
}

/** 最小化窗口上 CDP 输入全部静默失效：恢复正常并聚焦；恢复失败抛 WINDOW_NOT_INTERACTIVE。 */
async function restoreWindowIfNeeded(windowId: number): Promise<void> {
  const win = await chrome.windows.get(windowId)
  if (win.state !== 'minimized') return
  try {
    await chrome.windows.update(windowId, {state: 'normal', focused: true})
  } catch (error) {
    throw new Error(
      `${TOOL_ERROR_CODES.WINDOW_NOT_INTERACTIVE}: the window is minimized and could not be restored ` +
        `(${error instanceof Error ? error.message : String(error)}); restore it manually and retry`,
      {cause: error},
    )
  }
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

export interface ClickOptions {
  readonly button?: 'left' | 'right' | 'middle'
  readonly clickCount?: number
  readonly modifiers?: readonly InputModifier[]
}

export async function dispatchClick(tabId: number, x: number, y: number, options: ClickOptions = {}): Promise<void> {
  const button = options.button ?? 'left'
  const clickCount = options.clickCount ?? 1
  const params = {
    x,
    y,
    button,
    clickCount,
    modifiers: modifierBitmask(options.modifiers),
  }
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mousePressed', ...params})
  await send(tabId, 'Input.dispatchMouseEvent', {type: 'mouseReleased', ...params})
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

/** 一个键的完整 press：keyDown（组合键无 text，走 rawKeyDown）+ keyUp。 */
export async function dispatchKey(tabId: number, info: KeyDispatch, modifiers: readonly InputModifier[]): Promise<void> {
  const mask = modifierBitmask(modifiers)
  const text = keyDownText(info, mask)
  const base = {
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.windowsVirtualKeyCode,
    nativeVirtualKeyCode: info.windowsVirtualKeyCode,
    modifiers: mask,
  }
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: text === undefined ? 'rawKeyDown' : 'keyDown',
    ...base,
    ...(text !== undefined ? {text, unmodifiedText: text} : {}),
  })
  await send(tabId, 'Input.dispatchKeyEvent', {type: 'keyUp', ...base})
}

/** 快捷键序列（如 Ctrl+A / Delete 组成的清空操作）。 */
export async function pressKeyCombo(
  tabId: number,
  info: KeyDispatch,
  modifiers: readonly InputModifier[],
): Promise<void> {
  await dispatchKey(tabId, info, modifiers)
}

/** DOM.focus：把 ref 指向的元素设为焦点（不点击、不动光标位置）。 */
export async function focusNode(tabId: number, backendNodeId: number): Promise<void> {
  await send(tabId, 'DOM.focus', {backendNodeId})
}

/** 按 ref 读取子树 innerText（get_text 的取数路径）。 */
export async function resolveNodeInnerText(tabId: number, backendNodeId: number): Promise<string> {
  // CDP 返回形状：{object: RemoteObject}（属性名就叫 object）
  const resolveOnce = async (): Promise<string | undefined> => {
    const resolved = await send<{object?: {objectId?: string}}>(tabId, 'DOM.resolveNode', {backendNodeId})
    return resolved.object?.objectId
  }
  let objectId = await resolveOnce()
  if (objectId === undefined) {
    // DOM agent 未绑定该文档（新会话/导航后）：getDocument 重绑后再试一次
    await getDocumentRoot(tabId)
    objectId = await resolveOnce()
  }
  if (objectId === undefined) {
    throw new Error('could not resolve the referenced element to a JS object (it may be stale); call snapshot again')
  }
  const result = await send<{result?: {value?: unknown}}>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration:
      // Monaco 这类编辑器的 ref 是隐藏 textarea（innerText 恒空，文本在兄弟节点），
      // 自身读不到时向上找最近一个非空 innerText 的祖先（最多 4 层）
      'function () {' +
      '  var node = this, text = String(this.innerText || "");' +
      '  for (var i = 0; i < 4 && text.trim().length === 0; i++) {' +
      '    node = node.parentElement; if (!node) break;' +
      '    text = String(node.innerText || "");' +
      '  }' +
      '  return text;' +
      '}',
    returnByValue: true,
  })
  return typeof result.result?.value === 'string' ? result.result.value : ''
}

/** DOM.getDocument（pierce 全深），供弱交互扫描做文档序对齐。 */
export async function getDocumentRoot(tabId: number): Promise<unknown> {
  await enableOnce(tabId, 'DOM', 'DOM.enable')
  const result = await send<{root?: unknown}>(tabId, 'DOM.getDocument', {depth: -1, pierce: true})
  return result.root
}

export interface ViewportMetrics {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

/** 现采视口度量（每次调用都现读，无跨调用缓存——SW 重启后不存在旧值可复用）。 */
export async function getViewportMetrics(tabId: number): Promise<ViewportMetrics> {
  const raw = await evaluateJson<{w?: number; h?: number; dpr?: number}>(
    tabId,
    '({w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio})',
  )
  return {
    width: typeof raw.w === 'number' ? raw.w : 0,
    height: typeof raw.h === 'number' ? raw.h : 0,
    dpr: typeof raw.dpr === 'number' ? raw.dpr : 1,
  }
}

/**
 * 按元素读可访问性 value（ARIA 语义文本，非 DOM innerText）。
 * Monaco 这类虚拟滚动编辑器的 .view-lines 只含可见行，DOM 读数会以偏概全；
 * AX 树的 textbox value 携带完整模型文本，是唯一可靠读数。
 */
export async function getAxNodeValue(tabId: number, backendNodeId: number): Promise<string | undefined> {
  await enableOnce(tabId, 'Accessibility', 'Accessibility.enable')
  const result = await send<{nodes?: unknown}>(tabId, 'Accessibility.getPartialAXTree', {
    backendNodeId,
    fetchRelatives: false,
  })
  const nodes = parseAxNodes(result.nodes)
  const node = nodes.find((n) => n.backendDOMNodeId === backendNodeId) ?? nodes[0]
  return node?.value
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
