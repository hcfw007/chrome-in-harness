import {afterEach, beforeEach, expect, test, vi} from 'vitest'
import {assertUrlAllowed, authorizeTab} from './access'

vi.mock('../lib/tab-group', () => ({isTabManaged: vi.fn(async () => false)}))
vi.mock('../lib/domain-confirmation', () => ({requestDomainConfirmation: vi.fn()}))

let store: Record<string, unknown>

beforeEach(() => {
  store = {}
  vi.stubGlobal('chrome', {
    storage: {local: {get: async (key: string) => ({[key]: store[key]})}},
    tabs: {get: async () => ({id: 1, url: 'https://example.com'})},
  })
})

afterEach(() => vi.unstubAllGlobals())

test('requires domain confirmation by default', async () => {
  await expect(assertUrlAllowed('https://example.com')).rejects.toThrow('DOMAIN_CONFIRMATION_REQUIRED')
})

test('allows arbitrary HTTP and HTTPS hosts when explicitly enabled', async () => {
  store['allowAllDomains.v1'] = true
  await expect(assertUrlAllowed('https://unlisted.example.com')).resolves.toBeUndefined()
  await expect(assertUrlAllowed('http://127.0.0.1:3000')).resolves.toBeUndefined()
  store['allowAllDomains.v1'] = false
  await expect(assertUrlAllowed('https://unlisted.example.com')).rejects.toThrow('DOMAIN_CONFIRMATION_REQUIRED')
})

test.each(['chrome://extensions', 'chrome-extension://abc/options.html', 'file:///etc/passwd', 'about:blank', 'javascript:alert(1)', 'invalid'])('all-domains mode does not allow privileged or non-web URLs: %s', async (url) => {
  store['allowAllDomains.v1'] = true
  await expect(assertUrlAllowed(url)).rejects.toThrow('DOMAIN_NOT_ALLOWED')
})

test('authorizes a still-loading tab by its pendingUrl', async () => {
  const {isTabManaged} = await import('../lib/tab-group')
  vi.mocked(isTabManaged).mockResolvedValueOnce(true)
  store['allowAllDomains.v1'] = true
  vi.stubGlobal('chrome', {
    storage: {local: {get: async (key: string) => ({[key]: store[key]})}},
    tabs: {get: async () => ({id: 1, url: '', pendingUrl: 'https://example.com/'})},
  })
  await expect(authorizeTab(1)).resolves.toEqual({tabId: 1, url: 'https://example.com/'})
})

test('all-domains mode still rejects tabs outside the managed group', async () => {
  store['allowAllDomains.v1'] = true
  await expect(authorizeTab(1)).rejects.toThrow('TAB_NOT_MANAGED')
})
