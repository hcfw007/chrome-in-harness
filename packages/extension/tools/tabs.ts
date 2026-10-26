/** 标签页管理：list / new / select / close / takeover。tab_new 校验目标 URL、归入 Chrome in Harness 组；close 失效 ref。 */
import {TOOL_ERROR_CODES, ensureTabParams} from '@chrome-in-harness/protocol'
import {refStore} from '../lib/ref-store'
import {
  GROUP_COLOR,
  GROUP_TITLE,
  findReusableManagedGroup,
  getManagedGroupIds,
  isTabManaged,
} from '../lib/tab-group'
import {assertUrlAllowed, authorizeNavigate, tabClosed, toolError} from './access'

import type {ToolHandler} from './types'

/**
 * tab_select / tab_close 的组边界：只允许操作 Chrome in Harness 组内的 tab。
 * 其余工具（snapshot/click/…）都在 access.ts 里做同一道校验；这两个虽不触碰 debugger，
 * 但 select 会抢用户焦点、close 会关掉用户任意 tab，破坏性更强，必须同样收口。
 * 已关闭的 tab 先报 TAB_CLOSED（会话间隔后沿用旧 tabId 的常见坑），不与组边界混淆。
 */
async function assertManaged(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.id === undefined) throw tabClosed(tabId)
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
 * sameWindowOnly：只并入同窗口的组，否则在该窗口新建——并入别的窗口的组会把 tab
 * 物理搬到那个窗口（takeover 用户正在看的页时就是「抢页」）。
 */
async function groupTab(tabId: number, windowId: number | undefined, sameWindowOnly = false): Promise<void> {
  try {
    const candidate = await findReusableManagedGroup(windowId)
    const existing = sameWindowOnly && candidate?.windowId !== windowId ? undefined : candidate
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
  const created = await createManagedTab(url)
  return {tabId: created.id}
}

/** 无 URL 时开 about:blank：Chrome 默认的 chrome://newtab/ 无法 attach debugger，后续 navigate 必失败。 */
const BLANK_URL = 'about:blank'

async function createManagedTab(url: string | undefined): Promise<chrome.tabs.Tab & {id: number}> {
  if (url !== undefined) await authorizeNavigate(url)
  const created = await chrome.tabs.create({url: url ?? BLANK_URL, active: false})
  if (created.id === undefined) throw new Error('created tab has no id')
  await groupTab(created.id, created.windowId)
  return {...created, id: created.id}
}

/** 仅复用 agent 显式传入的标签；不挑选其他 agent 的标签，也不改变焦点或 URL。 */
export const ensureTab: ToolHandler = async (params) => {
  const {tabId, url} = ensureTabParams.parse(params)
  if (tabId !== undefined) {
    let existing: chrome.tabs.Tab | undefined
    try {
      existing = await chrome.tabs.get(tabId)
    } catch (error) {
      // 仅 Chrome 的明确「标签不存在」错误允许补建，其他错误必须透传。
      if (!(error instanceof Error) || !/^No tab with id: \d+\.?$/i.test(error.message)) throw error
    }
    if (existing !== undefined) {
      if (!(await isTabManaged(tabId))) {
        throw toolError(TOOL_ERROR_CODES.TAB_NOT_MANAGED,
          `tab ${tabId} still exists but is outside the 'Chrome in Harness' group (the user may have moved it, ` +
            'or the group was lost across a browser restart); it was not replaced or taken over. ' +
            'Call ensure_tab without tabId to get a fresh managed tab, or ask the user before takeover_tab.')
      }
      return {tabId, url: existing.url ?? '', reused: true}
    }
  }
  const created = await createManagedTab(url)
  if (!(await isTabManaged(created.id))) {
    throw toolError(TOOL_ERROR_CODES.TAB_NOT_MANAGED,
      `created tab ${created.id} could not be placed in the managed group; do not retry creation blindly.`)
  }
  return {
    tabId: created.id,
    url: created.pendingUrl ?? created.url ?? url ?? '',
    reused: false,
    ...(tabId !== undefined ? {replacedTabId: tabId} : {}),
  }
}

export const tabSelect: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  await assertManaged(tabId)
  const updated = await chrome.tabs.update(tabId, {active: true}).catch(() => undefined)
  if (updated === undefined) throw tabClosed(tabId)
  return {}
}

export const tabClose: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  await assertManaged(tabId)
  await chrome.tabs.remove(tabId).catch(() => {
    throw tabClosed(tabId)
  })
  refStore.invalidate(tabId)
  return {}
}

/**
 * takeover_tab：用户显式授权后把已打开的 tab 接管进受管组（P2）。
 * SECURITY-SENSITIVE，仅当用户明确要求在该 tab 工作时调用；URL 必须已在白名单内
 * （域边界不放宽），未授权域名走统一确认窗口；归组后用户随时可拖出撤销。
 * 对用户页面的副作用收口：
 * - 不激活、不聚焦、不导航；
 * - 不跨窗口搬 tab（只并入同窗口的受管组，否则就地新建组）；
 * - tab 已在用户自建的其他分组里 → 拒绝（TAB_IN_USER_GROUP），不擅自拆用户的分组；
 * - 回传 active：接管的是用户正在看的页时，调用方据此提醒用户。
 */
export const takeoverTab: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.id === undefined) throw tabClosed(tabId)
  const url = tab.url ?? ''
  const active = tab.active === true
  await assertUrlAllowed(url)
  if (await isTabManaged(tabId)) {
    return {tabId, url, alreadyManaged: true, active}
  }
  if (tab.groupId !== undefined && tab.groupId !== -1) {
    throw toolError(
      TOOL_ERROR_CODES.TAB_IN_USER_GROUP,
      `tab ${tabId} belongs to one of the user's own tab groups; it was left untouched. ` +
        'Ask the user to drag it out of that group (or into the \'Chrome in Harness\' group) and retry.',
    )
  }
  await groupTab(tabId, tab.windowId, true)
  if (!(await isTabManaged(tabId))) {
    throw new Error(`failed to move tab ${tabId} into the managed group (grouping was blocked); try again`)
  }
  return {tabId, url, alreadyManaged: false, active}
}
