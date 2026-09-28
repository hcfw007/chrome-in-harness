/**
 * CiC MCP tab group 边界：受管 tab 的唯一真源是「tab 的 groupId 指向名为
 * CiC MCP 的组」。用户把 tab 拖进/拖出组即时改变受管状态。
 */

export const GROUP_TITLE = 'CiC MCP'
export const GROUP_COLOR = 'blue' as const

/** 组标题三态前缀：操作中 / 刚成功 / 刚失败；空闲即无前缀。 */
export type GroupState = 'busy' | 'done' | 'error' | 'idle'

const STATE_PREFIX: Record<GroupState, string> = {
  busy: '⏳ ',
  done: '✅ ',
  error: '❌ ',
  idle: '',
}

function titleFor(state: GroupState): string {
  return `${STATE_PREFIX[state]}${GROUP_TITLE}`
}

const MANAGED_TITLES = new Set(Object.values(STATE_PREFIX).map((p) => `${p}${GROUP_TITLE}`))

export async function getManagedGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  const groups = await chrome.tabGroups.query({})
  return groups.filter((g) => typeof g.title === 'string' && MANAGED_TITLES.has(g.title))
}

/** tab 是否在受管组内。tab 不存在 / 无组 / 组名不符 → false。 */
export async function isTabManaged(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.groupId === undefined || tab.groupId === -1) return false
  const group = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
  return group !== undefined && typeof group.title === 'string' && MANAGED_TITLES.has(group.title)
}

/** 把所有受管组标题切到指定状态；失败静默（标记只是提示）。 */
export async function setGroupsState(state: GroupState): Promise<void> {
  try {
    const title = titleFor(state)
    for (const group of await getManagedGroups()) {
      await chrome.tabGroups.update(group.id, {title})
    }
  } catch (error) {
    console.warn('[tab-group] state marker failed:', error instanceof Error ? error.message : error)
  }
}

/** 受管组内的 tab 解析：聚焦窗口的活动 tab → 任意窗口的活动 tab → 组内第一个。 */
export async function findManagedTab(): Promise<chrome.tabs.Tab | undefined> {
  const groups = await getManagedGroups()
  const queries: chrome.tabs.QueryInfo[] = [
    {active: true, lastFocusedWindow: true},
    {active: true},
    {},
  ]
  for (const extra of queries) {
    for (const group of groups) {
      const tabs = await chrome.tabs.query({groupId: group.id, ...extra})
      const first = tabs.find((t) => t.id !== undefined)
      if (first !== undefined) return first
    }
  }
  return undefined
}
