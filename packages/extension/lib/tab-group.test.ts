/** tab-group 单测：受管组识别必须前缀归一，避免带状态前缀时误判无组而反复新建。 */
import {afterEach, describe, expect, test, vi} from 'vitest'

const {getManagedGroups, findReusableManagedGroup} = await import('./tab-group.js')

const GROUP_TITLE = 'Chrome in Harness'

function installChrome(groups: Array<{id: number; windowId: number; title?: string}>): void {
  ;(globalThis as unknown as {chrome: unknown}).chrome = {
    tabGroups: {
      query: async () =>
        groups.map((g) => ({id: g.id, windowId: g.windowId, title: g.title ?? GROUP_TITLE})),
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getManagedGroups 标题归一', () => {
  test('裸标题与三种状态前缀都算受管', async () => {
    installChrome([
      {id: 1, windowId: 1, title: GROUP_TITLE},
      {id: 2, windowId: 1, title: `⏳ ${GROUP_TITLE}`},
      {id: 3, windowId: 1, title: `✅ ${GROUP_TITLE}`},
      {id: 4, windowId: 1, title: `❌ ${GROUP_TITLE}`},
      {id: 5, windowId: 1, title: 'Some other group'},
    ])
    const found = await getManagedGroups()
    expect(found.map((g) => g.id)).toEqual([1, 2, 3, 4])
  })
})

describe('findReusableManagedGroup 复用既有组', () => {
  test('带 ⏳ 前缀的组仍能被复用（回归：曾经因此反复新建组）', async () => {
    installChrome([{id: 55, windowId: 1, title: `⏳ ${GROUP_TITLE}`}])
    const group = await findReusableManagedGroup(1)
    expect(group?.id).toBe(55)
  })

  test('优先同窗口的组', async () => {
    installChrome([
      {id: 1, windowId: 1},
      {id: 2, windowId: 2},
    ])
    expect((await findReusableManagedGroup(2))?.id).toBe(2)
  })

  test('无同窗口组时回退到任意窗口的第一个', async () => {
    installChrome([{id: 1, windowId: 1}])
    expect((await findReusableManagedGroup(99))?.id).toBe(1)
  })

  test('没有任何受管组时返回 undefined（调用方新建）', async () => {
    installChrome([])
    expect(await findReusableManagedGroup(1)).toBeUndefined()
  })
})
