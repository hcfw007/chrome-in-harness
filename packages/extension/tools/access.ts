/**
 * 工具鉴权编排，两层边界，顺序严格：
 * ① tab 边界：目标必须在 Chrome in Harness 组内（agent 的工作区），group 外的 tab 一律拒绝；
 * ② 域边界：tab URL（或将要导航的目标 URL）必须在域名白名单内。
 * 两层都过之后才允许触碰 chrome.debugger。
 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import type {ToolErrorCode} from '@chrome-in-harness/protocol'
import {requestDomainConfirmation} from '../lib/domain-confirmation'
import {isUrlAllowed} from '../lib/site-filter'
import {findManagedTab, isTabManaged} from '../lib/tab-group'
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
    `tab ${tabId} is outside the 'Chrome in Harness' group. Only tabs inside the group (created via tab_new) can be operated. ` +
      `If the user explicitly asked to work in this tab, call takeover_tab(tabId: ${tabId}) to move it into the managed group ` +
      '(its URL must already be in the allowlist).',
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
    throw new Error('no managed tab found; call tab_new to create one inside the Chrome in Harness group')
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

/** 取 URL 的 hostname（小写）；无 usable host（about:blank、chrome://…）返回 undefined。 */
function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.length > 0 ? host : undefined
  } catch {
    return undefined
  }
}

/**
 * 域边界校验：不在名单内时弹出确认窗口并抛 DOMAIN_CONFIRMATION_REQUIRED（非阻塞）。
 * 用户确认后重试同一工具即可通过；URL 无 usable host（about:blank、chrome://…）
 * 属于无法确认的情况，仍走 DOMAIN_NOT_ALLOWED。
 */
export async function assertUrlAllowed(url: string): Promise<void> {
  const rules = await getAllowlist()
  if (isUrlAllowed(url, rules)) return
  const host = hostOf(url)
  if (host === undefined) {
    throw toolError(
      TOOL_ERROR_CODES.DOMAIN_NOT_ALLOWED,
      `${describeHost(url)} is not in the allowlist and has no usable host; add the domain on the extension options page.`,
    )
  }
  await requestDomainConfirmation(host, url)
  throw toolError(
    TOOL_ERROR_CODES.DOMAIN_CONFIRMATION_REQUIRED,
    `${host} is not in the allowlist. A confirmation window has been opened — ask the user to allow it, then retry.`,
  )
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
