import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

const reload = vi.fn()
let installType = 'development'

beforeEach(() => {
  vi.useFakeTimers()
  reload.mockReset()
  installType = 'development'
  vi.stubGlobal('chrome', {
    management: {getSelf: async () => ({installType})},
    runtime: {reload, getManifest: () => ({version: '0.3.0'})},
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const {reloadExtension, RELOAD_DELAY_MS} = await import('./reload-extension.js')

describe('reload_extension', () => {
  test('replies first, then reloads after a short delay (so the WS response is flushed)', async () => {
    await expect(reloadExtension({})).resolves.toEqual({reloading: true, version: '0.3.0'})
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('refuses non-development installs and never reloads', async () => {
    installType = 'normal'
    await expect(reloadExtension({})).rejects.toThrow(/only available for an unpacked/)
    vi.advanceTimersByTime(RELOAD_DELAY_MS * 10)
    expect(reload).not.toHaveBeenCalled()
  })
})
