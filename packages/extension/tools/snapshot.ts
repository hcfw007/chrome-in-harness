/** snapshot / navigate 工具实现。 */
import {renderAxSnapshot} from '../lib/ax-snapshot'
import {ensureAttached} from '../lib/cdp'
import {getFullAxTree, getTabTitle, navigateAndWaitLoad} from '../lib/cdp-commands'
import {refStore} from '../lib/ref-store'
import {authorizeNavigate, authorizeTab, resolveTargetTab} from './access'

import type {ToolHandler} from './types'

export const snapshot: ToolHandler = async (params) => {
  const {tabId} = params as {tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const nodes = await getFullAxTree(target.tabId)
  const render = renderAxSnapshot(nodes)
  const version = refStore.store(target.tabId, target.url, render.refs)
  return {
    snapshot: render.text,
    version,
    url: target.url,
    truncated: render.truncated,
  }
}

/** navigate 只校验目标 URL（起点 tab 常是 about:blank，当前 URL 不在名单是正常的）。 */
export const navigate: ToolHandler = async (params) => {
  const {url, tabId} = params as {url: string; tabId?: number}
  await authorizeNavigate(url)
  const target = await resolveTargetTab(tabId)
  await ensureAttached(target.tabId)
  refStore.invalidate(target.tabId)
  const {loaded} = await navigateAndWaitLoad(target.tabId, url)
  const title = await getTabTitle(target.tabId)
  return {url, title, loaded}
}
