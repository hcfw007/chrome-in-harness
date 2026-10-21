/**
 * wait 工具：页面内条件（text / selector / urlContains / editorRendered）注入 Promise 轮询；
 * networkIdle 走 CDP 网络事件；不传条件 = 纯延迟。条件至多一个。
 */
import {countWaitConditions, waitParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {ensureFocusEmulation, evaluateJson, waitForNetworkIdle} from '../lib/cdp-commands'
import {scriptNumber} from '../lib/script-number'
import {authorizeTab} from './access'
import {parseToolParams} from './params'

import type {ToolHandler} from './types'

interface WaitParams {
  readonly text?: string
  readonly selector?: string
  readonly urlContains?: string
  readonly editorRendered?: boolean
  readonly networkIdle?: boolean
  readonly timeoutMs?: number
  readonly tabId?: number
}

/**
 * Monaco 类编辑器渲染完成：容器高度 > 40px 且宽度 > 200px（resize 后编辑器会塌缩成
 * 5×5 的窄条——高度达标但宽度不再，旧检查放过这种假就绪）且其内存在非空 view-line。
 * 检测到「高度够但宽度塌缩」时自动按父容器尺寸强制 layout() 重排救回
 * （无参 layout() 按自身 offsetWidth 测量，塌缩态会自我维持，必须显式传维度），
 * 下一轮轮询按恢复后的尺寸复查。
 */
const EDITOR_RENDERED_CHECK =
  '(function(){' +
  'var eds=document.querySelectorAll(".monaco-editor");' +
  'var collapsed=false;' +
  'for(var i=0;i<eds.length;i++){' +
  'var r=eds[i].getBoundingClientRect();' +
  'if(r.height<=40)continue;' +
  'if(r.width<=200){collapsed=true;continue;}' +
  'var lines=eds[i].querySelectorAll(".view-line");' +
  'for(var j=0;j<lines.length;j++){' +
  'var t=lines[j].textContent;' +
  'if(typeof t==="string"&&t.length>0)return true;' +
  '}' +
  '}' +
  'if(collapsed&&window.monaco&&window.monaco.editor&&typeof window.monaco.editor.getEditors==="function"){' +
  'try{window.monaco.editor.getEditors().forEach(function(m){' +
  'try{var host=m.getDomNode().parentElement;' +
  'if(host)m.layout({width:host.clientWidth,height:host.clientHeight})}catch(e){}' +
  '})}catch(e){}' +
  '}' +
  'return false' +
  '})()'

/** 页面内执行的等待脚本：轮询条件，页面内 setTimeout 兜底超时。 */
export function buildWaitScript(params: WaitParams, rawTimeoutMs: number): string {
  const timeoutMs = scriptNumber('timeoutMs', rawTimeoutMs)
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

/** networkIdle 的静默窗：与 navigate networkidle 一致。 */
const NETWORK_IDLE_HOLD_MS = 500

export const wait: ToolHandler = async (rawParams) => {
  // run_actions 步骤绕过 server 校验，这里按协议 schema 再挡一次（timeoutMs 会拼进页面脚本）
  const params: WaitParams = parseToolParams('wait', waitParams, rawParams)
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  await ensureFocusEmulation(target.tabId)
  const timeoutMs = params.timeoutMs ?? 8000

  if (countWaitConditions(params) === 0) {
    // 纯延迟：在扩展侧计时，不依赖页面 setTimeout（后台 tab 会被节流）
    await new Promise((resolve) => setTimeout(resolve, timeoutMs))
    return {matched: true, timedOut: false}
  }
  if (params.networkIdle === true) {
    const idle = await waitForNetworkIdle(target.tabId, NETWORK_IDLE_HOLD_MS, timeoutMs)
    return {matched: idle, timedOut: !idle}
  }

  const result = await evaluateJson<{matched: boolean; timedOut: boolean}>(
    target.tabId,
    buildWaitScript(params, timeoutMs),
  )
  return {matched: result.matched === true, timedOut: result.timedOut === true}
}
