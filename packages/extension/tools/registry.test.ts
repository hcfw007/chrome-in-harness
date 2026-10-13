import {beforeEach, expect, test, vi} from 'vitest'

const setGroupsState = vi.fn<(state: string) => Promise<void>>()

beforeEach(() => {
  vi.resetModules()
  setGroupsState.mockReset()
  setGroupsState.mockResolvedValue(undefined)
  vi.doMock('../lib/tab-group', () => ({setGroupsState}))
})

test('invoke dispatches a registered handler and toggles group state busy then done', async () => {
  const {invoke, register} = await import('./registry.js')
  register('get_text', async (params) => ({echo: params}))
  await expect(invoke('get_text', {ref: 'e1'})).resolves.toEqual({echo: {ref: 'e1'}})
  expect(setGroupsState.mock.calls.map((call) => call[0])).toEqual(['busy', 'done'])
})

test('invoke marks the group error and rethrows when a handler fails', async () => {
  const {invoke, register} = await import('./registry.js')
  register('get_text', async () => {
    throw new Error('STALE_REF: gone')
  })
  await expect(invoke('get_text', {})).rejects.toThrow('STALE_REF: gone')
  expect(setGroupsState.mock.calls.map((call) => call[0])).toEqual(['busy', 'error'])
})

test('invoke skips group state for ping and rejects unknown tools', async () => {
  const {invoke, register} = await import('./registry.js')
  register('ping', async () => 'pong')
  await expect(invoke('ping', {})).resolves.toBe('pong')
  expect(setGroupsState).not.toHaveBeenCalled()
  await expect(invoke('missing', {})).rejects.toThrow('Unknown tool')
})

test('register rejects a duplicate tool name', async () => {
  const {register} = await import('./registry.js')
  register('ping', async () => 'a')
  expect(() => register('ping', async () => 'b')).toThrow(/already registered/)
})
