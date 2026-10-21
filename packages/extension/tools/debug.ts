/** read_console / read_network 工具：从环形缓冲读取采集结果。 */
import {waitForResponseParams} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {ensureCollectors} from '../lib/cdp-commands'
import {consoleBuffer} from '../lib/console-buffer'
import {networkBuffer} from '../lib/network-buffer'
import type {NetworkEntry} from '../lib/network-buffer'
import {authorizeTab} from './access'
import {parseToolParams} from './params'

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

function toWire(e: NetworkEntry): Record<string, unknown> {
  return {
    method: e.method,
    url: e.url,
    status: e.status,
    mimeType: e.mimeType,
    error: e.error,
    timestamp: e.timestamp,
    durationMs: e.durationMs,
  }
}

export const readNetwork: ToolHandler = async (rawParams) => {
  const params = rawParams as {urlFilter?: string; limit?: number; tabId?: number}
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  ensureCollectors(target.tabId)
  const entries = networkBuffer.read(target.tabId, params.urlFilter, params.limit ?? 50)
  return {entries: entries.map(toWire)}
}

const WAIT_RESPONSE_POLL_MS = 100
const DEFAULT_LOOKBACK_MS = 2_000

/**
 * wait_for_response：轮询网络缓冲，等首个匹配请求完成。只读元数据（与 read_network 同源），不读响应体。
 * 回看窗口覆盖「点击触发请求 → 再调 wait」之间已经完成的情况。
 */
export const waitForResponse: ToolHandler = async (rawParams) => {
  // 必须在授权前校验：非数字 / 超上限的 timeoutMs 会让 deadline 永不到达，轮询在 SW 里无限进行
  const params = parseToolParams('wait_for_response', waitForResponseParams, rawParams)
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)
  ensureCollectors(target.tabId)
  const timeoutMs = params.timeoutMs ?? 8_000
  const since = Date.now() - (params.lookbackMs ?? DEFAULT_LOOKBACK_MS)
  const deadline = Date.now() + timeoutMs
  const match = {
    urlContains: params.urlContains,
    since,
    ...(params.method !== undefined ? {method: params.method} : {}),
    ...(params.status !== undefined ? {status: params.status} : {}),
  }
  for (;;) {
    const hit = networkBuffer.findCompleted(target.tabId, match)
    if (hit !== undefined) return {matched: true, timedOut: false, entry: toWire(hit)}
    if (Date.now() >= deadline) return {matched: false, timedOut: true}
    await new Promise((resolve) => setTimeout(resolve, WAIT_RESPONSE_POLL_MS))
  }
}
