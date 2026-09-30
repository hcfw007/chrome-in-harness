/**
 * evaluate_script 错误码单测：区分「脚本守卫拒绝」(SCRIPT_REJECTED) 与
 * 「脚本运行时失败」(SCRIPT_ERROR)。依赖以桩替换，隔离 chrome.*。
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

// access 依赖 chrome.*，仅用其 authorizeTab / toolError；两者以桩替换。
vi.mock('./access', () => ({
  authorizeTab: async (tabId?: number) => ({tabId: tabId ?? 1, url: 'https://x.test/'}),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))

vi.mock('../lib/cdp', () => ({ensureAttached: async () => {}}))

const evaluateJson = vi.fn<(tabId: number, expression: string) => Promise<unknown>>()
vi.mock('../lib/cdp-commands', () => ({
  evaluateJson: (tabId: number, expression: string) => evaluateJson(tabId, expression),
}))

const {evaluateScript} = await import('./evaluate.js')

beforeEach(() => {
  evaluateJson.mockReset()
})

describe('evaluate_script error codes', () => {
  test('guard rejection maps to SCRIPT_REJECTED (eval is blacklisted)', async () => {
    await expect(
      evaluateScript({expression: '(() => eval(`1`))()'} as never),
    ).rejects.toThrow(/^SCRIPT_REJECTED:/)
    expect(evaluateJson).not.toHaveBeenCalled()
  })

  test('oversized expression is rejected before execution', async () => {
    await expect(
      evaluateScript({expression: `(()=>'${'x'.repeat(9000)}')()`} as never),
    ).rejects.toThrow(/^SCRIPT_REJECTED:/)
    expect(evaluateJson).not.toHaveBeenCalled()
  })

  test('a runtime throw from the page maps to SCRIPT_ERROR (not REJECTED)', async () => {
    evaluateJson.mockRejectedValue(new Error('Error: boom'))
    await expect(
      evaluateScript({expression: '(() => { throw new Error("boom") })()'} as never),
    ).rejects.toThrow(/^SCRIPT_ERROR: /)
  })

  test('a timeout maps to SCRIPT_ERROR', async () => {
    evaluateJson.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
    )
    await expect(
      evaluateScript({expression: '(()=>1)()', timeoutMs: 5} as never),
    ).rejects.toThrow(/^SCRIPT_ERROR: .*timed out/)
  })

  test('a successful run returns the serialized value', async () => {
    evaluateJson.mockResolvedValue({a: 1})
    const result = (await evaluateScript({expression: '(()=>({a:1}))()'} as never)) as {
      type: string
    }
    expect(result.type).toBe('object')
  })
})
