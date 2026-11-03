/**
 * handle_dialog：处理原生对话框（alert / confirm / prompt / beforeunload）。
 * 对话框打开期间渲染进程被阻塞、其余工具以 DIALOG_OPEN 快速失败，这里是唯一出口。
 */
import {handleDialogParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {decideDialog, watchDialogs} from '../lib/dialog'
import {authorizeTab} from './access'
import {parseToolParams} from './params'

import type {ToolHandler} from './types'

export const handleDialog: ToolHandler = async (rawParams) => {
  // run_actions 的步骤 params 不经 server 侧 zod，这里必须按协议 schema 再校验一次
  const params = parseToolParams('handle_dialog', handleDialogParams, rawParams)
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  watchDialogs(target.tabId)
  const outcome = await decideDialog(target.tabId, params.accept, params.promptText)
  const dialog = outcome.dialog
  return {
    handled: outcome.handled,
    accept: params.accept,
    ...(dialog !== undefined ? {type: dialog.type, message: dialog.message} : {}),
    ...(dialog?.url !== undefined ? {url: dialog.url} : {}),
  }
}
