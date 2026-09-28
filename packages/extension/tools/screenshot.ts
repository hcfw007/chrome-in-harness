/** screenshot 工具实现。 */
import {ensureAttached} from '../lib/cdp'
import {captureScreenshot} from '../lib/cdp-commands'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

export const screenshot: ToolHandler = async (params) => {
  const {tabId} = params as {tabId?: number}
  const target = await authorizeTab(tabId)
  await ensureAttached(target.tabId)
  const data = await captureScreenshot(target.tabId)
  return {data, mimeType: 'image/png'}
}
