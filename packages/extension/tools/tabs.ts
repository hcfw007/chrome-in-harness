/** 标签页管理：list / new / select / close / takeover。tab_new 校验目标 URL、归入 Chrome in Harness 组；close 失效 ref。 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {refStore} from '../lib/ref-store'
import {
  GROUP_COLOR,
  GROUP_TITLE,
  findReusableManagedGroup,
  getManagedGroupIds,
  isTabManaged,
} from '../lib/tab-group'
import {assertUrlAllowed, authorizeNavigate, toolError} from './access'

import type {ToolHandler} from './types'

/**
 * tab_select / tab_close 的组边界：只允许操作 Chrome in Harness 组内的 tab。
 * 其余工具（snapshot/click/…）都在 access.ts 里做同一道校验；这两个虽不触碰 debugger，
 * 但 select 会抢用户焦点、close 会关掉用户任意 tab，破坏性更强，必须同样收口。
 */
async function assertManaged(tabId: number): Promise<void> {
  if (!(await isTabManaged(tabId))) {
    throw toolError(
      TOOL_ERROR_CODES.TAB_NOT_MANAGED,
      `tab ${tabId} is outside the 'Chrome in Harness' group. Only tabs inside the group (created via tab_new) can be operated.`,
    )
  }
}

/**
 * 把 tab 并进已有的 Chrome in Harness 组；不存在才新建一个。归组失败不影响 tab 本身。
 * 复用必须走前缀归一匹配（见 findReusableManagedGroup）：组标题会被 setGroupsState
 * 改写为「⏳/✅/❌ Chrome in Harness」，按裸标题精确查询会每次都误判为无组而反复新建。
 */
async function groupTab(tabId: number, windowId: number | undefined): Promise<void> {
  try {
    const existing = await findReusableManagedGroup(windowId)
    if (existing !== undefined) {
      await chrome.tabs.group({groupId: existing.id, tabIds: tabId})
      return
    }
    const newId = await chrome.tabs.group({
      createProperties: windowId !== undefined ? {windowId} : {},
      tabIds: tabId,
    })
    await chrome.tabGroups.update(newId, {title: GROUP_TITLE, color: GROUP_COLOR})
  } catch (error) {
    console.warn('[tabs] grouping failed:', error instanceof Error ? error.message : error)
  }
}

export const tabList: ToolHandler = async () => {
  const [tabs, managedGroupIds] = await Promise.all([chrome.tabs.query({}), getManagedGroupIds()])
  return {
    tabs: tabs
      .filter((t) => t.id !== undefined)
      .map((t) => {
        const groupId = t.groupId !== undefined && t.groupId !== -1 ? t.groupId : null
        return {
          tabId: t.id as number,
          title: t.title ?? '',
          url: t.url ?? '',
          active: t.active === true,
          groupId,
          managed: groupId !== null && managedGroupIds.has(groupId),
        }
      }),
  }
}

export const tabNew: ToolHandler = async (params) => {
  const {url} = params as {url?: string}
  if (url !== undefined) await authorizeNavigate(url)
  const created = await chrome.tabs.create({url, active: true})
  if (created.id === undefined) throw new Error('created tab has no id')
  await groupTab(created.id, created.windowId)
  return {tabId: created.id}
}

export const tabSelect: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  await assertManaged(tabId)
  const updated = await chrome.tabs.update(tabId, {active: true}).catch(() => undefined)
  if (updated === undefined) throw new Error(`tab ${tabId} not found`)
  return {}
}

export const tabClose: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  await assertManaged(tabId)
  await chrome.tabs.remove(tabId).catch(() => {
    throw new Error(`tab ${tabId} not found`)
  })
  refStore.invalidate(tabId)
  return {}
}

/**
 * takeover_tab：用户显式授权后把已打开的 tab 接管进受管组（P2）。
 * SECURITY-SENSITIVE，仅当用户明确要求在该 tab 工作时调用；URL 必须已在白名单内
 * （域边界不放宽），未授权域名走统一确认窗口；归组后用户随时可拖出撤销。
 */
export const takeoverTab: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.id === undefined) throw new Error(`tab ${tabId} not found`)
  const url = tab.url ?? ''
  await assertUrlAllowed(url)
  if (await isTabManaged(tabId)) {
    return {tabId, url}
  }
  await groupTab(tabId, tab.windowId)
  if (!(await isTabManaged(tabId))) {
    throw new Error(`failed to move tab ${tabId} into the managed group (grouping was blocked); try again`)
  }
  return {tabId, url}
}
