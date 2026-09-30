/**
 * 权限弹窗授权（Phase 3b）：用 chrome.permissions 把「用户确认某个域名可操作」
 * 落到浏览器原生的权限弹窗，作为运行时授权的第二种形态。
 *
 * 与 storage 白名单的区别：这是「一次性/可撤销的浏览器级 host 授权」，
 * 用户点掉弹窗即视为确认，可在 chrome://extensions 撤销。
 * 白名单仍是主闸（空名单拒绝全部），本模块只负责把域名同步进 optional host 权限，
 * 让域边界校验多一道浏览器背书。纯逻辑函数集中在文件顶部，便于单测。
 */

import {normalizeHostRule} from './site-filter'

export interface PermissionResult {
  readonly granted: boolean
  readonly origins: readonly string[]
}

/** bare host → optional host match pattern：http/https 全端口，含子域。 */
export function hostToMatchPattern(host: string): string {
  return `*://${host}/*`
}

export function originsForHost(host: string): readonly string[] {
  return [hostToMatchPattern(host)]
}

/** 归一域名输入；非法返回错误说明。 */
export function normalizeDomainForPermission(input: string): {ok: true; host: string} | {ok: false; error: string} {
  const normalized = normalizeHostRule(input)
  if (!normalized.ok) return {ok: false, error: normalized.error}
  return {ok: true, host: normalized.rule}
}

/** 尝试申请给定域名的 host 权限。返回是否授予（false = 用户在弹窗点了取消）。 */
export async function requestHostPermission(host: string): Promise<PermissionResult> {
  const origins = originsForHost(host)
  const granted = await chrome.permissions.request({origins: [...origins]})
  return {granted, origins}
}

/** 当前是否已持有该域名的 host 权限。 */
export async function hasHostPermission(host: string): Promise<boolean> {
  return chrome.permissions.contains({origins: [...originsForHost(host)]})
}

/** 撤销给定域名的 host 权限。 */
export async function revokeHostPermission(host: string): Promise<void> {
  await chrome.permissions.remove({origins: [...originsForHost(host)]})
}
