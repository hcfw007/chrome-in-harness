/**
 * request_permission 工具：针对某个域名发起浏览器原生权限弹窗授权。
 * 授权成功后把域名也写入 storage 白名单（双保险：弹窗 + 持久名单都要有）。
 * 仅当用户明确要求「允许/授权这个域名」时才调用。
 */

import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {requestHostPermission, normalizeDomainForPermission} from '../lib/permission-grant'
import {getAllowlist, setAllowlist} from '../lib/whitelist'
import {toolError} from './access'

import type {ToolHandler} from './types'

interface RequestPermissionParams {
  readonly domain: string
}

export const requestPermission: ToolHandler = async (rawParams) => {
  const params = rawParams as RequestPermissionParams

  const normalized = normalizeDomainForPermission(params.domain)
  if (!normalized.ok) {
    throw toolError(TOOL_ERROR_CODES.PERMISSION_DENIED, `invalid domain: ${normalized.error}`)
  }

  const {granted} = await requestHostPermission(normalized.host)

  if (granted) {
    // 弹窗已确认：同步写进 storage 白名单，让域边界校验一致放行
    const current = await getAllowlist()
    if (!current.includes(normalized.host)) {
      await setAllowlist([...current, normalized.host])
    }
    const updated = await getAllowlist()
    return {granted: true, domains: [...updated]}
  }

  return {granted: false, domains: [...(await getAllowlist())]}
}

export {normalizeDomainForPermission}
