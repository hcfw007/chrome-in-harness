/** probe / get_html：按 ref / selector / text 读元素状态与 outerHTML（只读，不滚动不点击）。 */
import {GET_HTML_DEFAULT_CHARS, getHtmlParams, probeParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {describeNodeRect, evaluateJson} from '../lib/cdp-commands'
import {
  PROBE_ELEMENT,
  buildGetHtmlScript,
  buildHtmlFunction,
  buildProbeScript,
  parseHtmlResult,
  parseProbeResult,
} from '../lib/element-inspect'
import {authorizeTab} from './access'
import {parseToolParams} from './params'
import {withRef} from './ref-recovery'

import type {ToolHandler} from './types'

interface LocatorParams {
  readonly ref?: string
  readonly selector?: string
  readonly text?: string
  readonly tabId?: number
}

function describeLocator(params: LocatorParams): string {
  if (params.selector !== undefined) return `selector ${JSON.stringify(params.selector)}`
  return `text ${JSON.stringify(params.text)}`
}

/** 调用方须先经 parseToolParams 校验（maxChars / selector 会拼进页面脚本）。 */
async function prepare(params: LocatorParams): Promise<number> {
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  return target.tabId
}

/** 不存在不是错误：exists:false 本身就是 probe 要回答的问题。ref 失效则照常报 STALE_REF。 */
export const probe: ToolHandler = async (rawParams) => {
  const params: LocatorParams = parseToolParams('probe', probeParams, rawParams)
  const tabId = await prepare(params)
  const raw =
    params.ref !== undefined
      ? await withRef(tabId, params.ref, async (entry) => describeNodeRect(tabId, entry.backendDOMNodeId, PROBE_ELEMENT))
      : await evaluateJson<unknown>(tabId, buildProbeScript(params))
  return parseProbeResult(raw)
}

export const getHtml: ToolHandler = async (rawParams) => {
  const params: LocatorParams & {maxChars?: number} = parseToolParams('get_html', getHtmlParams, rawParams)
  const tabId = await prepare(params)
  const maxChars = params.maxChars ?? GET_HTML_DEFAULT_CHARS
  const raw =
    params.ref !== undefined
      ? await withRef(tabId, params.ref, async (entry) =>
        describeNodeRect(tabId, entry.backendDOMNodeId, buildHtmlFunction(maxChars)),
      )
      : await evaluateJson<unknown>(tabId, buildGetHtmlScript(params, maxChars))
  const parsed = parseHtmlResult(raw)
  if (parsed === null) {
    throw new Error(`get_html: no element matches ${describeLocator(params)}; use probe to check existence first`)
  }
  return parsed
}
