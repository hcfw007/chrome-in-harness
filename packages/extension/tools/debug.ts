/** read_console / read_network 工具：从环形缓冲读取采集结果。 */
import {ensureAttached} from '../lib/cdp'
import {ensureCollectors} from '../lib/cdp-commands'
import {consoleBuffer} from '../lib/console-buffer'
import {networkBuffer} from '../lib/network-buffer'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

export const readConsole: ToolHandler = async (rawParams) => {
  const params = rawParams as {level?: 'error' | 'warning' | 'info' | 'all'; clear?: boolean; tabId?: number}
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  ensureCollectors(target.tabId)
  const entries = consoleBuffer.read(target.tabId, params.level ?? 'all')
  if (params.clear === true) consoleBuffer.clear(target.tabId)
  return {
    entries: entries.map((e) => ({level: e.level, text: e.text, timestamp: e.timestamp})),
  }
}

export const readNetwork: ToolHandler = async (rawParams) => {
  const params = rawParams as {urlFilter?: string; limit?: number; tabId?: number}
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  ensureCollectors(target.tabId)
  const entries = networkBuffer.read(target.tabId, params.urlFilter, params.limit ?? 50)
  return {
    entries: entries.map((e) => ({
      method: e.method,
      url: e.url,
      status: e.status,
      mimeType: e.mimeType,
      error: e.error,
      timestamp: e.timestamp,
    })),
  }
}
