import {afterEach, beforeEach, expect, test, vi} from 'vitest'
import {getAllDomainsAllowed, setAllDomainsAllowed, confirmAllDomainsAccess} from './domain-access'
import {ALLOWLIST_STORAGE_KEY} from './whitelist'

let store: Record<string, unknown>

beforeEach(() => {
  store = {[ALLOWLIST_STORAGE_KEY]: {version: 1, domains: ['example.com']}}
  vi.stubGlobal('chrome', {storage: {local: {
    get: async (key: string) => ({[key]: store[key]}),
    set: async (values: Record<string, unknown>) => {Object.assign(store, values)},
  }}})
})

afterEach(() => vi.unstubAllGlobals())

test('defaults to disabled and persists across subsequent reads without changing the allowlist', async () => {
  expect(await getAllDomainsAllowed()).toBe(false)
  await setAllDomainsAllowed(true)
  expect(await getAllDomainsAllowed()).toBe(true)
  expect(store[ALLOWLIST_STORAGE_KEY]).toEqual({version: 1, domains: ['example.com']})
  await setAllDomainsAllowed(false)
  expect(await getAllDomainsAllowed()).toBe(false)
})

test.each([undefined, null, 'true', 1, {}, {enabled: true}])('malformed setting stays disabled: %j', async (value) => {
  store['allowAllDomains.v1'] = value
  expect(await getAllDomainsAllowed()).toBe(false)
})

test('enabling requires risk confirmation and cancellation does not change storage', async () => {
  const confirm = vi.fn<(message: string) => boolean>(() => false)
  expect(await confirmAllDomainsAccess(true, confirm)).toBe(false)
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm.mock.calls[0]?.[0]).toContain('真实')
  expect(await getAllDomainsAllowed()).toBe(false)
  expect(await confirmAllDomainsAccess(true, () => true)).toBe(true)
  expect(await getAllDomainsAllowed()).toBe(true)
})

test('disabling does not require confirmation', async () => {
  await setAllDomainsAllowed(true)
  const confirm = vi.fn(() => false)
  expect(await confirmAllDomainsAccess(false, confirm)).toBe(false)
  expect(confirm).not.toHaveBeenCalled()
  expect(await getAllDomainsAllowed()).toBe(false)
})

test('storage failures propagate rather than reporting success', async () => {
  vi.stubGlobal('chrome', {storage: {local: {set: async () => {throw new Error('write failed')}}}})
  await expect(confirmAllDomainsAccess(true, () => true)).rejects.toThrow('write failed')
})
