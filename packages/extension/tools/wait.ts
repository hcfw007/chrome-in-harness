/** wait 工具：注入页面内 Promise 等条件（text / selector / urlContains / editorRendered 四选一）。 */
import {ensureAttached} from '../lib/cdp'
import {ensureFocusEmulation, evaluateJson} from '../lib/cdp-commands'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

interface WaitParams {
  readonly text?: string
  readonly selector?: string
  readonly urlContains?: string
  readonly editorRendered?: boolean
  readonly timeoutMs?: number
  readonly tabId?: number
}

/**
 * Monaco 类编辑器渲染完成：容器高度 > 40px（防 SPA 软导航后塌缩成 5×5px 的隐藏实例）
 * 且其内存在非空 view-line（虚拟滚动下可见行有内容即算渲染完成）。
 */
const EDITOR_RENDERED_CHECK =
  '(function(){' +
  'var eds=document.querySelectorAll(".monaco-editor");' +
  'for(var i=0;i<eds.length;i++){' +
  'var ed=eds[i];' +
  'if(ed.getBoundingClientRect().height<=40)continue;' +
  'var lines=ed.querySelectorAll(".view-line");' +
  'for(var j=0;j<lines.length;j++){' +
  'var t=lines[j].textContent;' +
  'if(typeof t==="string"&&t.length>0)return true;' +
  '}' +
  '}' +
  'return false' +
  '})()'

/** 页面内执行的等待脚本：轮询条件，页面内 setTimeout 兜底超时。 */
function buildWaitScript(params: WaitParams, timeoutMs: number): string {
  const check =
    params.text !== undefined
      ? `document.body !== null && document.body.innerText.includes(${JSON.stringify(params.text)})`
      : params.selector !== undefined
        ? `document.querySelector(${JSON.stringify(params.selector)}) !== null`
        : params.editorRendered === true
          ? EDITOR_RENDERED_CHECK
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
  await ensureFocusEmulation(target.tabId)
  const timeoutMs = params.timeoutMs ?? 8000
  const result = await evaluateJson<{matched: boolean; timedOut: boolean}>(
    target.tabId,
    buildWaitScript(params, timeoutMs),
  )
  return {matched: result.matched === true, timedOut: result.timedOut === true}
}
