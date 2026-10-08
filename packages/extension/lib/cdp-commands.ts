/** CDP 高层操作：每个函数对应一条（组）协议命令，全部经 lib/cdp.ts 的会话管理。 */

import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'

import {parseAxNodes} from './ax-types'
import type {AxNode} from './ax-types'
import {send, subscribeEvents, unsubscribeEvents, waitForEvent} from './cdp'
import {consoleBuffer} from './console-buffer'
import type {ConsoleLevel} from './console-buffer'
import type {InputModifier, KeyDispatch} from './keymap'
import {keyDownText, modifierBitmask, resolveKey} from './keymap'
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

/** 已开启焦点仿真的 tab（会话级；detach 后需重开）。 */
const focusEmulated = new Set<number>()

/** 清 enable 缓存（detach 后重 attach 需重新 enable）。 */
export function forgetDomains(tabId: number): void {
  enabledDomains.delete(tabId)
  focusEmulated.delete(tabId)
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
 * 开启焦点仿真：让后台 tab 自认为处于聚焦态，从而接收 CDP `Input.*`。
 * 这是 Playwright / Claude-in-Chrome 的做法（Emulation.setFocusEmulationEnabled，
 * 见 playwright crPage.ts 的 attach 流程），避免为了输入而把 tab 抢到前台打断用户。
 * 若仿真命令不被支持（极老内核），回退到激活 tab。
 */
export async function ensureFocusEmulation(tabId: number): Promise<void> {
  // 最小化窗口上连仿真也收不到输入，需先恢复窗口（不改变 tab 的前后台关系）
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab?.windowId !== undefined) await restoreWindowIfNeeded(tab.windowId)
  if (focusEmulated.has(tabId)) return
  try {
    await send(tabId, 'Emulation.setFocusEmulationEnabled', {enabled: true})
    focusEmulated.add(tabId)
  } catch (error) {
    console.warn(
      '[cdp] focus emulation unavailable, falling back to activateTab:',
      error instanceof Error ? error.message : error,
    )
    await activateTab(tabId)
  }
}

/**
 * 让目标 tab 可交互：tab 激活到前台 + 所在窗口若最小化则恢复。
 * 仅作焦点仿真的回退路径；正常输入类工具走 ensureFocusEmulation，不再抢前台。
 * CDP `Input.*` 在两种情况下被静默丢弃（命令成功返回但页面收不到事件，
 * 表现为「点了没反应」）：
 * ① tab 在后台（visibility:hidden 不处理输入）；
 * ② 所在窗口最小化（实测 Chrome 154，前台 tab 也一样丢）。
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
  let result: BoxModelResult
  try {
    result = await send<BoxModelResult>(tabId, 'DOM.getBoxModel', {backendNodeId})
  } catch (error) {
    // CDP 对 display:none / 已分离节点直接报错（如 "Node does not have a layout object"），换成可行动的文案
    throw new Error(
      `element has no layout (gone, hidden, or display:none) — take a new snapshot (${error instanceof Error ? error.message : String(error)})`,
      {cause: error},
    )
  }
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

export interface CursorPosition {
  readonly line: number
  readonly col: number
}

/** 焦点状态：activeElement 是否可编辑（monaco/原生输入/contentEditable）+ 光标落点。 */
export interface FocusState {
  readonly tag: string
  readonly editable: boolean
  readonly monaco: boolean
  readonly insertionPoint: CursorPosition | null
}

/**
 * 读当前焦点元素与光标（1-based line/col）。
 * Monaco 优先走 window.monaco API（隐藏 textarea 的 value 只含当前行，按行数算是错的）；
 * 原生 textarea/input 用 selectionStart 推算。焦点元素不是可编辑节点时 editable=false
 * （type 的落盘验证依据：往 body/button 上输入必然不落盘）。
 */
export async function readInputFocus(tabId: number): Promise<FocusState> {
  const script =
    '(function () {' +
    '  var active = document.activeElement;' +
    '  if (!active) return {tag: "none", editable: false, monaco: false, line: null, col: null};' +
    '  var tag = (active.tagName || "").toLowerCase();' +
    '  var monacoHost = false;' +
    '  try { monacoHost = !!(active.closest && active.closest(".monaco-editor")) } catch (err) {}' +
    '  var editable = monacoHost || tag === "textarea" || tag === "input" || active.isContentEditable === true;' +
    '  var pos = null;' +
    '  try {' +
    '    if (monacoHost) {' +
    '      var monaco = window.monaco;' +
    '      if (monaco && monaco.editor && typeof monaco.editor.getEditors === "function") {' +
    '        var editor = monaco.editor.getEditors().find(function (e) {' +
    '          try { return e.getDomNode().contains(active) } catch (err) { return false }' +
    '        });' +
    '        if (editor) {' +
    '          var p = editor.getPosition();' +
    '          if (p) pos = {line: p.lineNumber, col: p.column};' +
    '        }' +
    '      }' +
    '    } else if (tag === "textarea" || tag === "input") {' +
    '      var sel = active.selectionStart;' +
    '      if (typeof sel === "number") {' +
    '        var upto = String(active.value || "").slice(0, sel);' +
    '        var nl = upto.lastIndexOf("\\n");' +
    '        pos = {line: upto.split("\\n").length, col: sel - nl};' +
    '      }' +
    '    }' +
    '  } catch (err) {}' +
    '  return {tag: tag, editable: editable, monaco: monacoHost, line: pos ? pos.line : null, col: pos ? pos.col : null};' +
    '})()'
  const value = await evaluateJson<Record<string, unknown>>(tabId, script)
  if (typeof value !== 'object' || value === null) {
    return {tag: 'unknown', editable: false, monaco: false, insertionPoint: null}
  }
  const line = value['line']
  const col = value['col']
  const insertionPoint =
    typeof line === 'number' && typeof col === 'number' ? {line, col} : null
  return {
    tag: typeof value['tag'] === 'string' ? value['tag'] : 'unknown',
    editable: value['editable'] === true,
    monaco: value['monaco'] === true,
    insertionPoint,
  }
}

/**
 * 键盘通路探针：注入 F13 keydown 监听后派发一次 F13，验证 CDP 按键事件真的到达页面。
 * 背景：窗口 resize/失焦后 keyDown 通路可能整体静默失效（insertText 走 IME 仍活），
 * 按键工具必须先探测，死了就显式报错而不是无声吞掉。
 * 局限：焦点在 iframe 内时事件派发到子 frame，主 frame 监听收不到——调用方需结合
 * 焦点状态排除该情形。探针自身异常按「通路存活」处理（宁可放过不可误伤）。
 */
const KEY_PROBE_INSTALL =
  '(function(){' +
  'if(!window.__cicKeyProbeInstalled){' +
  'window.__cicKeyProbeInstalled=true;' +
  'window.addEventListener("keydown",function(e){if(e.key==="F13"){window.__cicKeyProbeHit=true}},true)' +
  '}' +
  'window.__cicKeyProbeHit=false;' +
  'return true' +
  '})()'
const KEY_PROBE_READ = '(window.__cicKeyProbeHit===true)'

export async function probeKeyPipeline(tabId: number): Promise<boolean> {
  const probe = resolveKey('F13')
  if (!probe.ok) return true
  try {
    await evaluateJson(tabId, KEY_PROBE_INSTALL)
    await dispatchKey(tabId, probe.info, [])
    return (await evaluateJson<unknown>(tabId, KEY_PROBE_READ)) === true
  } catch {
    return true
  }
}

/**
 * 键路保障：探针探测 → 死了先自愈 → 仍死则显式报错（resize/失焦后按键静默丢失的战报教训）。
 * 自愈两级：① 强制重开焦点仿真（清缓存重发，仿真状态可能被浏览器侧静默丢弃）；
 * ② activateTab 真激活兜底（内含最小化窗口恢复）。
 * 焦点在 iframe 内时探针天然收不到主 frame 事件，跳过死亡判定（无法验证，不误伤）。
 */
export async function ensureKeyPipelineAlive(tabId: number): Promise<void> {
  if (await probeKeyPipeline(tabId)) return
  focusEmulated.delete(tabId)
  await ensureFocusEmulation(tabId)
  if (await probeKeyPipeline(tabId)) return
  await activateTab(tabId)
  if (await probeKeyPipeline(tabId)) return
  const focus = await readInputFocus(tabId).catch(
    (): FocusState => ({tag: 'unknown', editable: false, monaco: false, insertionPoint: null}),
  )
  if (focus.tag === 'iframe') return
  throw new Error(
    'KEY_PIPELINE_DEAD: key events are not reaching the page (typically after a window resize or focus loss; ' +
      'IME text insertion may still work, but key presses are silently dropped). ' +
      'The window was re-focused without effect — avoid the keyboard path: use type(mode="set") for Monaco buffers ' +
      'or click-based activation, or restore the browser window manually.',
  )
}

export type MonacoSetKind = 'ok' | 'no-monaco' | 'ref-not-in-editor' | 'ambiguous'

export interface MonacoSetResult {
  readonly kind: MonacoSetKind
  readonly insertionPoint: CursorPosition | null
  readonly editorCount: number
}

/** monaco setValue 公共段：原子写缓冲后读回光标落点（文本经 JSON 序列化内联）。 */
function monacoApplySetValue(text: string): string {
  return (
    `editor.setValue(${JSON.stringify(text)});` +
    'var p = editor.getPosition();' +
    'return {kind: "ok", line: p ? p.lineNumber : null, col: p ? p.column : null};'
  )
}

/**
 * mode="set" 的落点：monaco.setValue 原子写整个缓冲。
 * 完全绕开键盘/焦点/IME 通路（窗口失焦、编辑器塌缩都不影响），也无需点击聚焦。
 * 带 backendNodeId 时用「编辑器 DOM 包含该节点」定位；不带时页面必须只有一个编辑器。
 */
export async function monacoSetValue(
  tabId: number,
  backendNodeId: number | undefined,
  text: string,
): Promise<MonacoSetResult> {
  const guard =
    'var monaco = window.monaco;' +
    'if (!monaco || !monaco.editor || typeof monaco.editor.getEditors !== "function") ' +
    'return {kind: "no-monaco", count: 0};' +
    'var editors = monaco.editor.getEditors();'
  if (backendNodeId !== undefined) {
    const objectId = await resolveBackendNode(tabId, backendNodeId)
    const result = await send<{result?: {value?: unknown}}>(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function (text) {' +
        guard +
        'var editor = null;' +
        'for (var i = 0; i < editors.length; i++) {' +
        '  try { if (editors[i].getDomNode().contains(this)) { editor = editors[i]; break } } catch (err) {}' +
        '}' +
        'if (!editor) return {kind: "ref-not-in-editor", count: editors.length};' +
        monacoApplySetValue(text) +
        '}',
      arguments: [{value: text}],
      returnByValue: true,
    })
    return parseMonacoSetResult(result.result?.value)
  }
  const result = await evaluateJson<unknown>(
    tabId,
    '(function () {' +
      guard +
      'if (editors.length !== 1) return {kind: "ambiguous", count: editors.length};' +
      'var editor = editors[0];' +
      monacoApplySetValue(text) +
      '})()',
  )
  return parseMonacoSetResult(result)
}

function parseMonacoSetResult(raw: unknown): MonacoSetResult {
  if (typeof raw !== 'object' || raw === null) {
    return {kind: 'no-monaco', insertionPoint: null, editorCount: 0}
  }
  const record = raw as Record<string, unknown>
  const kind = record['kind']
  const line = record['line']
  const col = record['col']
  const count = typeof record['count'] === 'number' ? record['count'] : 0
  if (kind === 'ok') {
    return {
      kind: 'ok',
      insertionPoint:
        typeof line === 'number' && typeof col === 'number' ? {line, col} : null,
      editorCount: count,
    }
  }
  if (kind === 'ref-not-in-editor' || kind === 'ambiguous') {
    return {kind, insertionPoint: null, editorCount: count}
  }
  return {kind: 'no-monaco', insertionPoint: null, editorCount: count}
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

/** backendNodeId → JS 对象 objectId；DOM agent 未绑定时 getDocument 重绑再试一次。 */
async function resolveBackendNode(tabId: number, backendNodeId: number): Promise<string> {
  const resolveOnce = async (): Promise<string | undefined> => {
    const resolved = await send<{object?: {objectId?: string}}>(tabId, 'DOM.resolveNode', {backendNodeId})
    return resolved.object?.objectId
  }
  let objectId = await resolveOnce()
  if (objectId === undefined) {
    await getDocumentRoot(tabId)
    objectId = await resolveOnce()
  }
  if (objectId === undefined) {
    throw new Error('could not resolve the referenced element to a JS object (it may be stale); call snapshot again')
  }
  return objectId
}

/** 按 ref 读取子树 innerText（get_text 的取数路径）。 */
export async function resolveNodeInnerText(tabId: number, backendNodeId: number): Promise<string> {
  const objectId = await resolveBackendNode(tabId, backendNodeId)
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
