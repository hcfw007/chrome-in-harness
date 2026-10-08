/** domain-confirmation 单测：pending 读写、窗口复用、允许/拒绝写白名单（mock chrome.*）。 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

import {
  CONFIRMATION_STORAGE_KEY,
  denyCurrentConfirmation,
  grantCurrentConfirmation,
  readPendingConfirmation,
  requestDomainConfirmation,
} from './domain-confirmation.js'
import {ALLOWLIST_STORAGE_KEY} from './whitelist.js'

interface FakeChrome {
  store: Record<string, unknown>
  windowsCreate: ReturnType<typeof vi.fn>
  windowsUpdate: ReturnType<typeof vi.fn>
  windowsGetAll: ReturnType<typeof vi.fn>
  getURLResult: string
  existingWindowId: number | undefined
}

function installChrome(): FakeChrome {
  const fake: FakeChrome = {
    store: {},
    windowsCreate: vi.fn(async () => ({id: 99})),
    windowsUpdate: vi.fn(async () => ({})),
    windowsGetAll: vi.fn(async () => []),
    getURLResult: 'chrome-extension://abc/confirm.html',
    existingWindowId: undefined,
  }
  const chromeMock = {
    storage: {
      local: {
        get: async (key: string) => {
          const bag: Record<string, unknown> = {}
          if (key in fake.store) bag[key] = fake.store[key]
          return bag
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(fake.store, obj)
        },
        remove: async (key: string) => {
          delete fake.store[key]
        },
      },
    },
    runtime: {
      getURL: (p: string) => `chrome-extension://abc/${p}`,
    },
    windows: {
      create: fake.windowsCreate,
      update: fake.windowsUpdate,
      getAll: fake.windowsGetAll,
    },
  }
  ;(globalThis as unknown as {chrome: unknown}).chrome = chromeMock
  return fake
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('requestDomainConfirmation', () => {
  test('写入 pending 并新建确认窗口', async () => {
    const fake = installChrome()
    await requestDomainConfirmation('example.com', 'https://example.com/x')
    const pending = await readPendingConfirmation()
    expect(pending?.host).toBe('example.com')
    expect(pending?.url).toBe('https://example.com/x')
    expect(fake.windowsCreate).toHaveBeenCalledTimes(1)
    expect(fake.windowsCreate).toHaveBeenCalledWith(
      expect.objectContaining({type: 'popup', url: 'chrome-extension://abc/confirm.html'}),
    )
  })

  test('已有确认窗口时只聚焦、不重复弹窗', async () => {
    const fake = installChrome()
    fake.windowsGetAll.mockResolvedValue([
      {id: 42, tabs: [{url: 'chrome-extension://abc/confirm.html'}]},
    ])
    await requestDomainConfirmation('other.com', 'https://other.com/')
    expect(fake.windowsUpdate).toHaveBeenCalledWith(42, {focused: true})
    expect(fake.windowsCreate).not.toHaveBeenCalled()
  })
})

describe('readPendingConfirmation', () => {
  test('损坏数据回退 undefined', async () => {
    const fake = installChrome()
    fake.store[CONFIRMATION_STORAGE_KEY] = {version: 1, host: 123}
    expect(await readPendingConfirmation()).toBeUndefined()
  })
})

describe('grant / deny', () => {
  test('允许：写入白名单并清 pending', async () => {
    const fake = installChrome()
    fake.store[CONFIRMATION_STORAGE_KEY] = {version: 1, host: 'new.com', url: 'https://new.com/', createdAt: 1}
    await grantCurrentConfirmation()
    const stored = fake.store[ALLOWLIST_STORAGE_KEY] as {domains: string[]}
    expect(stored.domains).toContain('new.com')
    expect(fake.store[CONFIRMATION_STORAGE_KEY]).toBeUndefined()
  })

  test('允许：域名已在名单时不重复添加', async () => {
    const fake = installChrome()
    fake.store[ALLOWLIST_STORAGE_KEY] = {version: 1, domains: ['dup.com']}
    fake.store[CONFIRMATION_STORAGE_KEY] = {version: 1, host: 'dup.com', url: 'https://dup.com/', createdAt: 1}
    await grantCurrentConfirmation()
    const stored = fake.store[ALLOWLIST_STORAGE_KEY] as {domains: string[]}
    expect(stored.domains).toEqual(['dup.com'])
  })

  test('拒绝：不写白名单，仅清 pending', async () => {
    const fake = installChrome()
    fake.store[CONFIRMATION_STORAGE_KEY] = {version: 1, host: 'deny.com', url: 'https://deny.com/', createdAt: 1}
    await denyCurrentConfirmation()
    expect(fake.store[ALLOWLIST_STORAGE_KEY]).toBeUndefined()
    expect(fake.store[CONFIRMATION_STORAGE_KEY]).toBeUndefined()
  })
})
