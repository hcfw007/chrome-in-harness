/**
 * 工具鉴权编排，两层边界，顺序严格：
 * ① tab 边界：目标必须在 CiC MCP 组内（agent 的工作区），group 外的 tab 一律拒绝；
 * ② 域边界：tab URL（或将要导航的目标 URL）必须在域名白名单内。
 * 两层都过之后才允许触碰 chrome.debugger。
 */
import {TOOL_ERROR_CODES} from '@cic/protocol'
import type {ToolErrorCode} from '@cic/protocol'
import {findManagedTab, isTabManaged} from '../lib/tab-group'
import {isUrlAllowed} from '../lib/site-filter'
import {getAllowlist} from '../lib/whitelist'

export function toolError(code: ToolErrorCode, message: string): Error {
  return new Error(`${code}: ${message}`)
}

export interface TargetTab {
  readonly tabId: number
  readonly url: string
}

function notManaged(tabId: number): Error {
  return toolError(
    TOOL_ERROR_CODES.TAB_NOT_MANAGED,
    `tab ${tabId} is outside the 'CiC MCP' group. Only tabs inside the group (created via tab_new) can be operated.`,
  )
}

/** 解析操作目标 tab：显式 tabId 必须在受管组内；缺省 = 受管组内最近活动的 tab（绝不是用户的活动 tab）。 */
export async function resolveTargetTab(tabId?: number): Promise<TargetTab> {
  if (tabId !== undefined) {
    if (!(await isTabManaged(tabId))) throw notManaged(tabId)
    const tab = await chrome.tabs.get(tabId)
    return {tabId: tab.id as number, url: tab.url ?? ''}
  }
  const tab = await findManagedTab()
  if (tab === undefined || tab.id === undefined) {
    throw new Error('no managed tab found; call tab_new to create one inside the CiC MCP group')
  }
  return {tabId: tab.id, url: tab.url ?? ''}
}

function describeHost(url: string): string {
  try {
    const host = new URL(url).hostname
    return host.length > 0 ? host : url
  } catch {
    return url
  }
}

async function assertUrlAllowed(url: string): Promise<void> {
  const rules = await getAllowlist()
  if (!isUrlAllowed(url, rules)) {
    throw toolError(
      TOOL_ERROR_CODES.DOMAIN_NOT_ALLOWED,
      `${describeHost(url)} is not in the allowlist. Add the domain on the extension options page and retry.`,
    )
  }
}

/** 解析并校验当前 tab（组内 + 域名单）。不通过绝不触碰 chrome.debugger。 */
export async function authorizeTab(tabId?: number): Promise<TargetTab> {
  const target = await resolveTargetTab(tabId)
  await assertUrlAllowed(target.url)
  return target
}

/** 校验一个将要导航到的 URL（域边界）；tab 边界由调用方在解析 tab 时保证。 */
export async function authorizeNavigate(url: string): Promise<void> {
  await assertUrlAllowed(url)
}
