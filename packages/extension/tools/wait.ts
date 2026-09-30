/** wait 工具：注入页面内 Promise 等条件（text / selector / urlContains 三选一）。 */
import {ensureAttached} from '../lib/cdp'
import {evaluateJson} from '../lib/cdp-commands'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

interface WaitParams {
  readonly text?: string
  readonly selector?: string
  readonly urlContains?: string
  readonly timeoutMs?: number
  readonly tabId?: number
}

/** 页面内执行的等待脚本：轮询条件，页面内 setTimeout 兜底超时。 */
function buildWaitScript(params: WaitParams, timeoutMs: number): string {
  const check =
    params.text !== undefined
      ? `document.body !== null && document.body.innerText.includes(${JSON.stringify(params.text)})`
      : params.selector !== undefined
        ? `document.querySelector(${JSON.stringify(params.selector)}) !== null`
        : `location.href.includes(${JSON.stringify(params.urlContains ?? '')})`
  return `(async () => {
    const started = Date.now()
    while (Date.now() - started < ${timeoutMs}) {
      if (${check}) return {matched: true, timedOut: false}
      await new Promise((r) => setTimeout(r, 100))
    }
    return {matched: false, timedOut: true}
  })()`
}

export const wait: ToolHandler = async (rawParams) => {
  const params = rawParams as WaitParams
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  const timeoutMs = params.timeoutMs ?? 8000
  const result = await evaluateJson<{matched: boolean; timedOut: boolean}>(
    target.tabId,
    buildWaitScript(params, timeoutMs),
  )
  return {matched: result.matched === true, timedOut: result.timedOut === true}
}
