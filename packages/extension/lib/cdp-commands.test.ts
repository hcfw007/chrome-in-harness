/** activateTab / ensureFocusEmulation 单测（mock chrome.*，实测发现的边界）。 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

// cdp-commands 顶层依赖 ./cdp，桩掉以免牵连真实 chrome.debugger
vi.mock('./cdp', () => ({
  send: vi.fn(),
  subscribeEvents: vi.fn(),
  waitForEvent: vi.fn(),
}))

const {send} = await import('./cdp.js')
const {activateTab, ensureFocusEmulation, forgetDomains} = await import('./cdp-commands.js')
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
