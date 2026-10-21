/**
 * 注入页面脚本的参数校验回归：run_actions 步骤 params 是 record<unknown>，
 * 不经 server 侧 zod 校验；handler 必须自行按协议 schema 校验，
 * 否则字符串型「数字」会被拼进页面脚本，绕过 evaluate_script 的脚本守卫。
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

vi.mock('./access', () => ({
  authorizeTab: async (tabId?: number) => ({tabId: tabId ?? 1, url: 'https://x.test/'}),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))

vi.mock('../lib/cdp', () => ({ensureAttached: async () => {}}))

const evaluateJson = vi.fn<(tabId: number, expression: string) => Promise<unknown>>()
const describeNodeRect = vi.fn<(tabId: number, backendNodeId: number, describeFn: string) => Promise<unknown>>()
const dispatchClick = vi.fn<(...args: unknown[]) => Promise<void>>()
vi.mock('../lib/cdp-commands', () => ({
  evaluateJson: (tabId: number, expression: string) => evaluateJson(tabId, expression),
  describeNodeRect: (tabId: number, backendNodeId: number, describeFn: string) =>
    describeNodeRect(tabId, backendNodeId, describeFn),
  dispatchClick: (...args: unknown[]) => dispatchClick(...args),
  ensureFocusEmulation: async () => {},
  getViewportMetrics: async () => ({width: 800, height: 600, dpr: 1}),
  waitForNetworkIdle: async () => true,
}))

vi.mock('./ref-recovery', () => ({
  withRef: async (_tabId: number, _ref: string, fn: (entry: {backendDOMNodeId: number}) => Promise<unknown>) =>
    fn({backendDOMNodeId: 1}),
}))

vi.mock('./snapshot', () => ({snapshot: async () => ({})}))

const {clickAt, scrollTo} = await import('./interact.js')
const {getHtml, probe} = await import('./inspect.js')
const {buildWaitScript, wait} = await import('./wait.js')

const PAYLOAD = '1);0;(1'

function scriptsSent(): string[] {
  return [
    ...evaluateJson.mock.calls.map((call) => call[1]),
    ...describeNodeRect.mock.calls.map((call) => call[2]),
  ]
}

beforeEach(() => {
  evaluateJson.mockReset()
  evaluateJson.mockResolvedValue(null)
  describeNodeRect.mockReset()
  describeNodeRect.mockResolvedValue(null)
  dispatchClick.mockReset()
  dispatchClick.mockResolvedValue(undefined)
})

describe('handlers reject non-numeric params before building page scripts', () => {
  test('click_at with a string x is rejected and nothing reaches the page', async () => {
    await expect(clickAt({x: PAYLOAD, y: 1, coordinates: true})).rejects.toThrow(/click_at: invalid params .*x/)
    expect(scriptsSent().some((script) => script.includes(PAYLOAD))).toBe(false)
    expect(evaluateJson).not.toHaveBeenCalled()
    expect(dispatchClick).not.toHaveBeenCalled()
  })

  test('click_at with valid params still hit-tests and clicks', async () => {
    await clickAt({x: 10, y: 20, coordinates: true})
    expect(evaluateJson.mock.calls[0]?.[1]).toContain('document.elementFromPoint(10, 20)')
    expect(dispatchClick).toHaveBeenCalledTimes(1)
  })

  test('get_html with a string maxChars is rejected (selector and ref modes)', async () => {
    await expect(getHtml({selector: 'a', maxChars: PAYLOAD})).rejects.toThrow(/get_html: invalid params .*maxChars/)
    await expect(getHtml({ref: 'e1', maxChars: PAYLOAD})).rejects.toThrow(/get_html: invalid params .*maxChars/)
    expect(scriptsSent()).toEqual([])
  })

  test('get_html / probe / scroll_to keep the locator count message', async () => {
    await expect(getHtml({selector: 'a', text: 'b'})).rejects.toThrow('pass exactly one of ref / selector / text (got 2)')
    await expect(probe({})).rejects.toThrow('pass exactly one of ref / selector / text (got 0)')
    await expect(scrollTo({selector: 'a', ref: 'e1'})).rejects.toThrow('pass exactly one of ref / selector / text (got 2)')
    expect(scriptsSent()).toEqual([])
  })

  test('probe / scroll_to reject a non-string selector', async () => {
    await expect(probe({selector: 42})).rejects.toThrow(/probe: invalid params .*selector/)
    await expect(scrollTo({selector: ['a']})).rejects.toThrow(/scroll_to: invalid params .*selector/)
    expect(scriptsSent()).toEqual([])
  })

  test('wait with a string timeoutMs is rejected', async () => {
    await expect(wait({selector: 'a', timeoutMs: PAYLOAD})).rejects.toThrow(/wait: invalid params .*timeoutMs/)
    expect(scriptsSent()).toEqual([])
  })

  test('wait keeps the condition-count message', async () => {
    await expect(wait({selector: 'a', text: 'b'})).rejects.toThrow(/pass at most one of .* \(got 2\)/)
    expect(scriptsSent()).toEqual([])
  })

  test('buildWaitScript throws on a non-number timeoutMs', () => {
    expect(() => buildWaitScript({selector: 'a'}, PAYLOAD as unknown as number)).toThrow(/finite number/)
    expect(() => buildWaitScript({selector: 'a'}, Number.NaN)).toThrow(/finite number/)
  })

  test('wait with valid params builds the polling script', async () => {
    evaluateJson.mockResolvedValue({matched: true, timedOut: false})
    await expect(wait({selector: 'a', timeoutMs: 500})).resolves.toEqual({matched: true, timedOut: false})
    expect(evaluateJson.mock.calls[0]?.[1]).toContain('Date.now() - started < 500')
  })
})
