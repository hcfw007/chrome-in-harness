/** 标签页管理：list / new / select / close。tab_new 校验目标 URL、归入 Chrome in Harness 组；close 失效 ref。 */
import {refStore} from '../lib/ref-store'
import {GROUP_COLOR, GROUP_TITLE} from '../lib/tab-group'
import {authorizeNavigate} from './access'

import type {ToolHandler} from './types'

/** 把 tab 并进本窗口的 Chrome in Harness 组；不存在则新建。归组失败不影响 tab 本身。 */
async function groupTab(tabId: number, windowId: number | undefined): Promise<void> {
  try {
    const existing = await chrome.tabGroups.query(
      windowId !== undefined ? {title: GROUP_TITLE, windowId} : {title: GROUP_TITLE},
    )
    const groupId = existing[0]?.id
    if (groupId !== undefined) {
      await chrome.tabs.group({groupId, tabIds: tabId})
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
  const tabs = await chrome.tabs.query({})
  return {
    tabs: tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({
        tabId: t.id as number,
        title: t.title ?? '',
        url: t.url ?? '',
        active: t.active === true,
      })),
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
  const updated = await chrome.tabs.update(tabId, {active: true}).catch(() => undefined)
  if (updated === undefined) throw new Error(`tab ${tabId} not found`)
  return {}
}

export const tabClose: ToolHandler = async (params) => {
  const {tabId} = params as {tabId: number}
  await chrome.tabs.remove(tabId).catch(() => {
    throw new Error(`tab ${tabId} not found`)
  })
  refStore.invalidate(tabId)
  return {}
}
