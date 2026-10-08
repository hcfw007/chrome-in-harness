/** tabs 工具单测：覆盖 tab_select / tab_close 的受管组边界（mock chrome 依赖）。 */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

// tab-group 与 whitelist 依赖 chrome.*，测试里以桩替换。
const isTabManaged = vi.fn<(tabId: number) => Promise<boolean>>()
const findReusableManagedGroup =
  vi.fn<(windowId: number | undefined) => Promise<{id: number; windowId: number} | undefined>>()
vi.mock('../lib/tab-group', () => ({
  GROUP_TITLE: 'Chrome in Harness',
  GROUP_COLOR: 'blue',
  isTabManaged: (tabId: number) => isTabManaged(tabId),
  findReusableManagedGroup: (windowId: number | undefined) => findReusableManagedGroup(windowId),
}))

const getAllowlist = vi.fn<() => Promise<readonly string[]>>()
vi.mock('../lib/whitelist', () => ({
  getAllowlist: () => getAllowlist(),
}))

const {tabSelect, tabClose, tabNew} = await import('./tabs.js')

/** 最小 chrome.tabs / tabGroups 桩。 */
function installChrome(overrides: {
  update?: (tabId: number, props: unknown) => Promise<unknown>
  remove?: (tabId: number) => Promise<void>
  create?: (props: unknown) => Promise<{id?: number; windowId?: number}>
  groupsUpdate?: (id: number, props: unknown) => Promise<void>
  group?: (props: unknown) => Promise<number>
}): void {
  ;(globalThis as unknown as {chrome: unknown}).chrome = {
    tabs: {
      update:
        overrides.update ??
        (async (tabId: number) => {
          if (tabId === 404) return undefined
          return {id: tabId, active: true}
        }),
      remove:
        overrides.remove ??
        (async (tabId: number) => {
          if (tabId === 404) throw new Error('no tab')
        }),
      create: overrides.create ?? (async () => ({id: 9001, windowId: 1})),
    },
    tabGroups: {
      update: overrides.groupsUpdate ?? (async () => {}),
    },
  }
  // tabs.ts 只走 groupTab（写路径）与 assertManaged；组合调用给个空实现
  ;(globalThis as unknown as {chrome: {tabs: Record<string, unknown>}}).chrome.tabs.group =
    overrides.group ?? (async () => 7)
}

beforeEach(() => {
  isTabManaged.mockReset()
  findReusableManagedGroup.mockReset()
  findReusableManagedGroup.mockResolvedValue(undefined)
  getAllowlist.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tab_select / tab_close 组边界', () => {
  test('select rejects a tab outside the managed group', async () => {
    isTabManaged.mockResolvedValue(false)
    installChrome({})
    await expect(tabSelect({tabId: 42} as never)).rejects.toThrow('TAB_NOT_MANAGED')
  })

  test('close rejects a tab outside the managed group', async () => {
    isTabManaged.mockResolvedValue(false)
    installChrome({})
    await expect(tabClose({tabId: 42} as never)).rejects.toThrow('TAB_NOT_MANAGED')
  })

  test('select activates a managed tab', async () => {
    isTabManaged.mockResolvedValue(true)
    const update = vi.fn(async () => ({id: 42, active: true}))
    installChrome({update})
    await expect(tabSelect({tabId: 42} as never)).resolves.toEqual({})
    expect(update).toHaveBeenCalledWith(42, {active: true})
  })

  test('close removes a managed tab', async () => {
    isTabManaged.mockResolvedValue(true)
    const remove = vi.fn(async () => {})
    installChrome({remove})
    await expect(tabClose({tabId: 42} as never)).resolves.toEqual({})
    expect(remove).toHaveBeenCalledWith(42)
  })

  test('select surfaces a not-found error for a vanished managed tab', async () => {
    isTabManaged.mockResolvedValue(true)
    installChrome({update: async () => undefined})
    await expect(tabSelect({tabId: 777} as never)).rejects.toThrow('not found')
  })
})

describe('tab_new 组边界与白名单', () => {
  test('new rejects URLs outside the allowlist before creating a tab', async () => {
    getAllowlist.mockResolvedValue(['feishu.cn'])
    const create = vi.fn(async () => ({id: 1, windowId: 1}))
    installChrome({create})
    await expect(tabNew({url: 'https://evil.example/'} as never)).rejects.toThrow(
      'DOMAIN_NOT_ALLOWED',
    )
    expect(create).not.toHaveBeenCalled()
  })

  test('new creates and groups an allowed tab when no managed group exists', async () => {
    getAllowlist.mockResolvedValue(['feishu.cn'])
    const create = vi.fn(async () => ({id: 9001, windowId: 1}))
    const group = vi.fn(async () => 7)
    const groupsUpdate = vi.fn(async () => {})
    // 无可复用组 → 走「新建组并命名」分支
    findReusableManagedGroup.mockResolvedValue(undefined)
    installChrome({create, group, groupsUpdate})
    const result = (await tabNew({url: 'https://project.feishu.cn/x'} as never)) as {
      tabId: number
    }
    expect(result.tabId).toBe(9001)
    expect(group).toHaveBeenCalled()
    expect(groupsUpdate).toHaveBeenCalled()
  })

  test('new reuses an existing managed group instead of creating a new one', async () => {
    getAllowlist.mockResolvedValue(['feishu.cn'])
    const create = vi.fn(async () => ({id: 9001, windowId: 1}))
    const group = vi.fn(async () => 7)
    const groupsUpdate = vi.fn(async () => {})
    // 已有受管组（标题可能带 ⏳ 前缀，但 findReusableManagedGroup 已归一匹配）
    findReusableManagedGroup.mockResolvedValue({id: 55, windowId: 1})
    installChrome({create, group, groupsUpdate})
    await tabNew({url: 'https://project.feishu.cn/x'} as never)
    // 并入既有组：groupId 指定 55，且不新建、不改标题
    expect(group).toHaveBeenCalledWith({groupId: 55, tabIds: 9001})
    expect(groupsUpdate).not.toHaveBeenCalled()
  })
})
