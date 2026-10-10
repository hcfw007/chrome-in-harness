import {beforeEach, describe, expect, test, vi} from 'vitest'
import type {RefEntry} from '../lib/ref-store'
import {refStore} from '../lib/ref-store'
import {authorizeTab} from './access'
import {withRef} from './ref-recovery'
import {takeSnapshot} from './snapshot'

vi.mock('../lib/cdp', () => ({ensureAttached: vi.fn()}))
vi.mock('./snapshot', () => ({takeSnapshot: vi.fn()}))
vi.mock('./access', () => ({
  authorizeTab: vi.fn(async (tabId: number) => ({tabId, url: 'https://example.com'})),
  toolError: (code: string, message: string) => new Error(`${code}: ${message}`),
}))

const oldEntry: RefEntry = {ref: 'e1-abcd1', backendDOMNodeId: 11, role: 'button', name: 'Save'}
const freshEntry = {...oldEntry, ref: 'e2-abcd2', frameId: undefined}

beforeEach(() => {
  vi.clearAllMocks()
  refStore.clear()
  refStore.store(1, 'https://example.com', 'abcd1', [oldEntry], 1)
  vi.mocked(takeSnapshot).mockImplementation(async () => {
    refStore.store(1, 'https://example.com', 'abcd2', [freshEntry], 2)
    return {text: '', version: 2, token: 'abcd2', url: 'https://example.com', truncated: false, refs: [freshEntry]}
  })
})

describe('withRef recovery', () => {
  test('refreshes the snapshot and retries the same element after a stale CDP node', async () => {
    const operation = vi.fn<(entry: RefEntry) => Promise<string>>()
      .mockRejectedValueOnce(new Error('No node with given id'))
      .mockResolvedValueOnce('saved')
    await expect(withRef(1, oldEntry.ref, operation)).resolves.toBe('saved')
    expect(takeSnapshot).toHaveBeenCalledOnce()
    expect(operation.mock.calls[1]?.[0]).toEqual(freshEntry)
  })

  test('reports NO_SNAPSHOT when navigation invalidates refs during an operation', async () => {
    const operation = vi.fn(async () => {
      refStore.invalidate(1)
      throw new Error('Node is detached from document')
    })
    await expect(withRef(1, oldEntry.ref, operation)).rejects.toThrow(/^NO_SNAPSHOT:/)
    expect(operation).toHaveBeenCalledOnce()
    expect(takeSnapshot).not.toHaveBeenCalled()
  })

  test('reports STALE_REF if the element remains detached after one recovery attempt', async () => {
    const operation = vi.fn(async () => {throw new Error('No node with given id')})
    await expect(withRef(1, oldEntry.ref, operation)).rejects.toThrow(/^STALE_REF:/)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(takeSnapshot).toHaveBeenCalledOnce()
  })

  test('recovers superseded refs by identity rather than their numeric ref', async () => {
    refStore.store(1, 'https://example.com', 'abcd2', [{...freshEntry, backendDOMNodeId: 99}], 2)
    const operation = vi.fn(async (entry: RefEntry) => entry.backendDOMNodeId)
    await expect(withRef(1, oldEntry.ref, operation)).resolves.toBe(11)
    expect(operation).toHaveBeenCalledOnce()
  })

  test('rejects refs from another worker era without executing or refreshing', async () => {
    const operation = vi.fn()
    await expect(withRef(1, 'e1-ffff1', operation)).rejects.toThrow(/^STALE_REF:/)
    expect(operation).not.toHaveBeenCalled()
    expect(takeSnapshot).not.toHaveBeenCalled()
  })

  test('propagates non-stale errors without retrying', async () => {
    const operation = vi.fn(async () => {throw new Error('permission denied')})
    await expect(withRef(1, oldEntry.ref, operation)).rejects.toThrow('permission denied')
    expect(operation).toHaveBeenCalledOnce()
    expect(takeSnapshot).not.toHaveBeenCalled()
  })

  test('never substitutes a different element that reused the old numeric ref', async () => {
    vi.mocked(takeSnapshot).mockResolvedValue({
      text: '', version: 2, token: 'abcd2', url: 'https://example.com', truncated: false,
      refs: [{...freshEntry, ref: 'e1-abcd2', backendDOMNodeId: 99}],
    })
    const operation = vi.fn(async () => {throw new Error('No node with given id')})
    await expect(withRef(1, oldEntry.ref, operation)).rejects.toThrow(/^STALE_REF:/)
    expect(operation).toHaveBeenCalledOnce()
  })

  test('rechecks the managed-tab and domain boundary before refreshing', async () => {
    vi.mocked(authorizeTab).mockRejectedValueOnce(new Error('TAB_NOT_MANAGED: tab was moved out'))
    const operation = vi.fn(async () => {throw new Error('No node with given id')})
    await expect(withRef(1, oldEntry.ref, operation)).rejects.toThrow(/^TAB_NOT_MANAGED:/)
    expect(takeSnapshot).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledOnce()
  })
})
