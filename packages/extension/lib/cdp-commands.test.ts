/** activateTab / ensureFocusEmulation 单测（mock chrome.*，实测发现的边界）。 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

// cdp-commands 顶层依赖 ./cdp，桩掉以免牵连真实 chrome.debugger
vi.mock('./cdp', () => ({
  send: vi.fn(),
  subscribeEvents: vi.fn(),
  waitForEvent: vi.fn(),
}))

const {send} = await import('./cdp.js')
const {activateTab, ensureFocusEmulation, forgetDomains, probeKeyPipeline, readFocusedValue, readInputFocus} =
  await import('./cdp-commands.js')
const sendMock = vi.mocked(send)

/** 最小 chrome.tabs / chrome.windows 桩，记录调用并支持注入行为。 */
function installChrome(overrides: {
  tab?: {active?: boolean; windowId?: number}
  windowState?: string
  windowsUpdate?: (windowId: number, props: unknown) => Promise<void>
  tabsGetThrows?: boolean
}): {
  tabsUpdate: ReturnType<typeof vi.fn>
  windowsUpdate: (windowId: number, props: unknown) => Promise<void>
} {
  const tabsUpdate = vi.fn(async () => ({}))
  const windowsUpdate: (windowId: number, props: unknown) => Promise<void> =
    overrides.windowsUpdate ?? vi.fn(async () => {})
  ;(globalThis as unknown as {chrome: unknown}).chrome = {
    tabs: {
      get: async () => {
        if (overrides.tabsGetThrows) throw new Error('no tab')
        return {id: 1, active: overrides.tab?.active ?? true, windowId: overrides.tab?.windowId ?? 10}
      },
      update: tabsUpdate,
    },
    windows: {
      get: async () => ({id: 10, state: overrides.windowState ?? 'normal'}),
      update: windowsUpdate,
    },
  }
  return {tabsUpdate, windowsUpdate}
}

describe('activateTab', () => {
  test('tab 已激活且窗口正常：不写 tabs / windows', async () => {
    const {tabsUpdate, windowsUpdate} = installChrome({tab: {active: true}, windowState: 'normal'})
    await activateTab(1)
    expect(tabsUpdate).not.toHaveBeenCalled()
    expect(windowsUpdate).not.toHaveBeenCalled()
  })

  test('tab 在后台：激活 tab', async () => {
    const {tabsUpdate} = installChrome({tab: {active: false}})
    await activateTab(1)
    expect(tabsUpdate).toHaveBeenCalledWith(1, {active: true})
  })

  test('窗口最小化：自动恢复正常并聚焦', async () => {
    const {windowsUpdate} = installChrome({windowState: 'minimized'})
    await activateTab(1)
    expect(windowsUpdate).toHaveBeenCalledWith(10, {state: 'normal', focused: true})
  })

  test('窗口恢复失败：抛 WINDOW_NOT_INTERACTIVE 而非静默', async () => {
    installChrome({
      windowState: 'minimized',
      windowsUpdate: async () => {
        throw new Error('locked')
      },
    })
    await expect(activateTab(1)).rejects.toThrow(/^WINDOW_NOT_INTERACTIVE: /)
  })

  test('tabs.get 意外失败：仅告警不阻塞', async () => {
    installChrome({tabsGetThrows: true})
    await expect(activateTab(1)).resolves.toBeUndefined()
  })
})

describe('ensureFocusEmulation', () => {
  beforeEach(() => {
    sendMock.mockReset()
    forgetDomains(1)
    forgetDomains(2)
  })

  test('正常路径：开焦点仿真，且不激活 tab（不抢前台）', async () => {
    sendMock.mockResolvedValue({} as never)
    const {tabsUpdate} = installChrome({tab: {active: false}, windowState: 'normal'})
    await ensureFocusEmulation(1)
    expect(sendMock).toHaveBeenCalledWith(1, 'Emulation.setFocusEmulationEnabled', {enabled: true})
    expect(tabsUpdate).not.toHaveBeenCalled()
  })

  test('幂等：同 tab 二次调用不再发送（除非 forgetDomains）', async () => {
    sendMock.mockResolvedValue({} as never)
    installChrome({tab: {active: true}, windowState: 'normal'})
    await ensureFocusEmulation(1)
    await ensureFocusEmulation(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    forgetDomains(1)
    await ensureFocusEmulation(1)
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  test('仿真不被支持：回退到 activateTab（激活 tab）', async () => {
    sendMock.mockRejectedValue(new Error('method not found') as never)
    const {tabsUpdate} = installChrome({tab: {active: false}, windowState: 'normal'})
    await ensureFocusEmulation(1)
    expect(tabsUpdate).toHaveBeenCalledWith(1, {active: true})
  })

  test('最小化窗口：先恢复窗口（不改变 tab 前后台关系）', async () => {
    sendMock.mockResolvedValue({} as never)
    const {tabsUpdate, windowsUpdate} = installChrome({tab: {active: false}, windowState: 'minimized'})
    await ensureFocusEmulation(1)
    expect(windowsUpdate).toHaveBeenCalledWith(10, {state: 'normal', focused: true})
    expect(tabsUpdate).not.toHaveBeenCalled()
  })
})

describe('probeKeyPipeline（默认动作探针）', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  /** 按脚本内容路由 Runtime.evaluate：BEGIN（createElement）→ 注入值；READ（input.value）→ 注入结果。 */
  function mockProbe(alive: boolean, beginOk = true): {dispatchCount: () => number} {
    let dispatchCount = 0
    sendMock.mockImplementation(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.['expression'] ?? '')
        if (expr.includes('createElement')) return {result: {value: beginOk}}
        return {result: {value: alive}}
      }
      if (method === 'Input.dispatchKeyEvent') {
        dispatchCount += 1
        return {}
      }
      return {}
    })
    return {dispatchCount: () => dispatchCount}
  }

  test('默认动作生效（b 落入临时 input）：判定存活', async () => {
    const probe = mockProbe(true)
    await expect(probeKeyPipeline(1)).resolves.toBe(true)
    // keyDown + keyUp 一次派发
    expect(probe.dispatchCount()).toBe(2)
  })

  test('事件送达但默认动作被丢弃（监听探针的假阳性场景）：判定死亡', async () => {
    mockProbe(false)
    await expect(probeKeyPipeline(1)).resolves.toBe(false)
  })

  test('焦点窃取失败（页面抢回焦点）：中止探测且不派发按键，按存活处理', async () => {
    const probe = mockProbe(true, false)
    await expect(probeKeyPipeline(1)).resolves.toBe(true)
    expect(probe.dispatchCount()).toBe(0)
  })

  test('读取脚本异常（无法确认）：按存活处理', async () => {
    sendMock.mockImplementation(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.['expression'] ?? '')
        if (expr.includes('createElement')) return {result: {value: true}}
        return {result: {value: null}}
      }
      return {}
    })
    await expect(probeKeyPipeline(1)).resolves.toBe(true)
  })
})

describe('焦点读取下钻 iframe', () => {
  /** 用假 document/window 真实执行页面脚本，覆盖 iframe 下钻逻辑。 */
  function runAgainst(topDoc: unknown): void {
    const win = {document: topDoc}
    sendMock.mockImplementation(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method !== 'Runtime.evaluate') return {}
      const expr = String(params?.['expression'] ?? '')
      const value: unknown = new Function('document', 'window', `return ${expr}`)(topDoc, win)
      return {result: {value}}
    })
  }
  const textarea = (value: string) => ({tagName: 'TEXTAREA', value, selectionStart: value.length, closest: () => null})

  beforeEach(() => {
    sendMock.mockReset()
  })

  test('同源 iframe（JumpServer xterm）：读到内部 textarea，判定可编辑', async () => {
    const inner = {activeElement: textarea('ls'), defaultView: {}}
    runAgainst({activeElement: {tagName: 'IFRAME', contentDocument: inner}})
    await expect(readInputFocus(1)).resolves.toMatchObject({tag: 'textarea', editable: true, crossOrigin: false})
    await expect(readFocusedValue(1)).resolves.toBe('ls')
  })

  test('跨域 iframe（contentDocument 为 null）：标记 crossOrigin，不回读值', async () => {
    runAgainst({activeElement: {tagName: 'IFRAME', contentDocument: null}})
    await expect(readInputFocus(1)).resolves.toMatchObject({tag: 'iframe', editable: false, crossOrigin: true})
    await expect(readFocusedValue(1)).resolves.toBeNull()
  })

  test('访问 contentDocument 抛错：同样按跨域处理', async () => {
    const frame = {
      tagName: 'IFRAME',
      get contentDocument(): never {
        throw new Error('SecurityError')
      },
    }
    runAgainst({activeElement: frame})
    await expect(readInputFocus(1)).resolves.toMatchObject({crossOrigin: true})
  })

  test('iframe 内无焦点元素：停在 iframe 上，按不可编辑报告', async () => {
    runAgainst({activeElement: {tagName: 'IFRAME', contentDocument: {activeElement: null}}})
    await expect(readInputFocus(1)).resolves.toMatchObject({tag: 'iframe', editable: false, crossOrigin: false})
  })
})

describe('probeKeyPipeline 还原 iframe 内焦点', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  test('焦点在同源 iframe 的 textarea：探测结束后还原到该 textarea，而非 <iframe>', async () => {
    const focused: string[] = []
    const inner = {tagName: 'TEXTAREA', focus: () => focused.push('inner-textarea')}
    const frame = {tagName: 'IFRAME', contentDocument: {activeElement: inner}, focus: () => focused.push('iframe')}
    const probeInput: {value: string; focus: () => void; remove: () => void; setAttribute: () => void; style: object} = {
      value: '',
      style: {},
      setAttribute: () => undefined,
      remove: () => undefined,
      focus: () => {
        doc.activeElement = probeInput as never
      },
    }
    const doc: {activeElement: unknown; body: {appendChild: () => void}; createElement: () => unknown} = {
      activeElement: frame,
      body: {appendChild: () => undefined},
      createElement: () => probeInput,
    }
    const win: Record<string, unknown> = {document: doc}
    sendMock.mockImplementation(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === 'Input.dispatchKeyEvent') {
        if (params?.['type'] === 'keyDown') probeInput.value = 'b'
        return {}
      }
      if (method !== 'Runtime.evaluate') return {}
      const expr = String(params?.['expression'] ?? '')
      const value: unknown = new Function('document', 'window', `return ${expr}`)(doc, win)
      return {result: {value}}
    })
    await expect(probeKeyPipeline(1)).resolves.toBe(true)
    expect(focused).toEqual(['inner-textarea'])
  })
})
