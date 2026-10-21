/** reload handler：先让 ref 失效再刷新，返回刷新后的 URL（重定向），并按协议 schema 校验参数。 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

const calls: string[] = []

const authorizeTab = vi.fn(async (tabId?: number) => ({tabId: tabId ?? 7, url: 'https://a.test/old'}))
vi.mock('./access', () => ({
  authorizeTab: (tabId?: number) => authorizeTab(tabId),
  authorizeNavigate: async () => {},
  resolveTargetTab: async () => ({tabId: 7, url: 'https://a.test/old'}),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))

vi.mock('../lib/cdp', () => ({ensureAttached: async () => {}}))

const reloadAndWait = vi.fn(async (_tabId: number, _hard: boolean, _waitUntil: string) => {
  calls.push('reload')
  return {loaded: true}
})
let currentUrl: string | undefined = 'https://a.test/new'
vi.mock('../lib/cdp-commands', () => ({
  reloadAndWait: (tabId: number, hard: boolean, waitUntil: string) => reloadAndWait(tabId, hard, waitUntil),
  getTabTitle: async () => 'New',
  getTabUrl: async () => currentUrl,
  navigateAndWait: async () => ({loaded: true}),
  evaluateJson: async () => [],
  getDocumentRoot: async () => ({}),
  getFullAxTree: async () => [],
}))

vi.mock('../lib/ref-store', () => ({
  refStore: {invalidate: () => calls.push('invalidate'), nextVersion: () => 1, store: () => {}, resolve: () => ({kind: 'no_snapshot'})},
}))
vi.mock('../lib/snapshot-version', () => ({saveVersionFloor: async () => {}, versionFloor: async () => 0}))

const {reload} = await import('./snapshot.js')

beforeEach(() => {
  calls.length = 0
  reloadAndWait.mockClear()
  currentUrl = 'https://a.test/new'
})

describe('reload', () => {
  test('invalidates refs before reloading, so no stale ref can hit the new page', async () => {
    await reload({hard: true})
    expect(calls).toEqual(['invalidate', 'reload'])
    expect(reloadAndWait).toHaveBeenCalledWith(7, true, 'domcontentloaded')
  })

  test('reports the post-reload URL (redirects), falling back to the pre-reload one', async () => {
    await expect(reload({})).resolves.toEqual({url: 'https://a.test/new', title: 'New', loaded: true, hard: false})
    currentUrl = undefined
    await expect(reload({})).resolves.toMatchObject({url: 'https://a.test/old'})
  })

  test('rejects malformed params before authorizing (run_actions steps bypass server zod)', async () => {
    authorizeTab.mockClear()
    await expect(reload({waitUntil: 'forever'})).rejects.toThrow(/reload: invalid params .*waitUntil/)
    expect(authorizeTab).not.toHaveBeenCalled()
    expect(reloadAndWait).not.toHaveBeenCalled()
  })
})
