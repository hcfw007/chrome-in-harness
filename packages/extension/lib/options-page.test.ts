import {afterEach, beforeEach, expect, test, vi} from 'vitest'

function element() {
  return {checked: false, disabled: true, value: '', textContent: '', className: '',
    addEventListener: vi.fn<(event: string, listener: () => void) => void>(),
  }
}

let toggle: ReturnType<typeof element>
let status: ReturnType<typeof element>
let domains: ReturnType<typeof element>
let store: Record<string, unknown>
let confirm: ReturnType<typeof vi.fn<(message: string) => boolean>>
let write: ReturnType<typeof vi.fn<(values: Record<string, unknown>) => Promise<void>>>

beforeEach(async () => {
  vi.resetModules()
  toggle = element()
  status = element()
  domains = element()
  store = {'allowlist.v1': {version: 1, domains: ['example.com']}}
  confirm = vi.fn(() => true)
  write = vi.fn(async (values) => {Object.assign(store, values)})
  const elements: Record<string, ReturnType<typeof element>> = {
    '#all-domains': toggle, '#status': status, '#domains': domains,
    '#save': element(), '#mode-status': element(),
  }
  vi.stubGlobal('document', {querySelector: (selector: string) => elements[selector]})
  vi.stubGlobal('window', {confirm})
  vi.stubGlobal('chrome', {storage: {local: {
    get: async (key: string) => ({[key]: store[key]}), set: write,
  }}})
})

afterEach(() => vi.unstubAllGlobals())

async function loadPage(): Promise<void> {
  await import('../entrypoints/options/main')
  await vi.waitFor(() => expect(toggle.disabled).toBe(false))
}

async function change(checked: boolean): Promise<void> {
  toggle.checked = checked
  toggle.addEventListener.mock.calls.find(([event]) => event === 'change')?.[1]()
  await vi.waitFor(() => expect(toggle.disabled).toBe(false))
}

test('options page defaults off, confirms enabling, and restores whitelist mode when disabled', async () => {
  await loadPage()
  expect(toggle.checked).toBe(false)
  expect(domains.value).toBe('example.com')
  await change(true)
  expect(confirm).toHaveBeenCalledOnce()
  expect(store['allowAllDomains.v1']).toBe(true)
  await change(false)
  expect(confirm).toHaveBeenCalledOnce()
  expect(store['allowAllDomains.v1']).toBe(false)
  expect(domains.value).toBe('example.com')
})

test('options page restores the persisted switch without prompting', async () => {
  store['allowAllDomains.v1'] = true
  await loadPage()
  expect(toggle.checked).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
})

test('cancelling risk confirmation leaves the switch off and does not write', async () => {
  confirm.mockReturnValue(false)
  await loadPage()
  await change(true)
  expect(toggle.checked).toBe(false)
  expect(write).not.toHaveBeenCalled()
})

test('failed persistence restores the switch and displays the error', async () => {
  await loadPage()
  write.mockRejectedValueOnce(new Error('storage failed'))
  await change(true)
  expect(toggle.checked).toBe(false)
  expect(status.textContent).toContain('storage failed')
  expect(status.className).toBe('err')
})
