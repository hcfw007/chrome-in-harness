/**
 * wait_for_response 参数校验回归：run_actions 步骤 params 是 record<unknown>，不经 server 侧 zod。
 * 字符串 / 超上限的 timeoutMs 会让 deadline 永不到达，SW 里 100ms 轮询无限进行；
 * 字符串 lookbackMs 让 since 变 NaN，任意已完成请求都会命中。handler 必须在授权前按协议 schema 拒绝。
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

const authorizeTab = vi.fn(async (tabId?: number) => ({tabId: tabId ?? 1, url: 'https://x.test/'}))
vi.mock('./access', () => ({
  authorizeTab: (tabId?: number) => authorizeTab(tabId),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))

const ensureAttached = vi.fn(async () => {})
vi.mock('../lib/cdp', () => ({ensureAttached: () => ensureAttached()}))
vi.mock('../lib/cdp-commands', () => ({ensureCollectors: () => {}}))

const findCompleted = vi.fn<(tabId: number, match: unknown) => unknown>()
vi.mock('../lib/network-buffer', () => ({
  networkBuffer: {findCompleted: (tabId: number, match: unknown) => findCompleted(tabId, match)},
}))

const {waitForResponse} = await import('./debug.js')

const HIT = {
  method: 'GET',
  url: 'https://x.test/api/sync',
  status: 200,
  mimeType: 'application/json',
  error: undefined,
  timestamp: 1,
  durationMs: 5,
  completedAt: 10,
}

function expectNothingStarted(): void {
  expect(authorizeTab).not.toHaveBeenCalled()
  expect(ensureAttached).not.toHaveBeenCalled()
  expect(findCompleted).not.toHaveBeenCalled()
}

beforeEach(() => {
  authorizeTab.mockClear()
  ensureAttached.mockClear()
  findCompleted.mockReset()
  findCompleted.mockReturnValue(undefined)
})

describe('wait_for_response validates params before authorizing or polling', () => {
  test('string timeoutMs is rejected', async () => {
    await expect(waitForResponse({urlContains: '/api', timeoutMs: 'x'})).rejects.toThrow(
      /wait_for_response: invalid params .*timeoutMs/,
    )
    expectNothingStarted()
  })

  test('timeoutMs beyond the 30000 cap is rejected', async () => {
    await expect(waitForResponse({urlContains: '/api', timeoutMs: 1e12})).rejects.toThrow(
      /wait_for_response: invalid params .*timeoutMs/,
    )
    expectNothingStarted()
  })

  test('string lookbackMs is rejected', async () => {
    await expect(waitForResponse({urlContains: '/api', lookbackMs: '5'})).rejects.toThrow(
      /wait_for_response: invalid params .*lookbackMs/,
    )
    expectNothingStarted()
  })

  test('valid params poll the buffer with a finite since window', async () => {
    findCompleted.mockReturnValue(HIT)
    const before = Date.now()
    await expect(waitForResponse({urlContains: '/api', lookbackMs: 500, timeoutMs: 1000})).resolves.toMatchObject({
      matched: true,
      timedOut: false,
      entry: {url: HIT.url, status: 200},
    })
    expect(authorizeTab).toHaveBeenCalledTimes(1)
    const match = findCompleted.mock.calls[0]?.[1] as {urlContains: string; since: number}
    expect(match.urlContains).toBe('/api')
    expect(Number.isFinite(match.since)).toBe(true)
    expect(match.since).toBeGreaterThanOrEqual(before - 500)
    expect(match.since).toBeLessThanOrEqual(Date.now() - 500)
  })
})
