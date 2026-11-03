/**
 * 原生对话框订阅 / 处理回归：
 * ① 事件把 CDP opening 参数转成待处理状态，closed 清空；
 * ② decideDialog 总是先发命令 —— SW 重启后本地状态为空但对话框仍在，「No dialog is showing」
 *    才代表真的没有（handled:false），其他错误必须透传；
 * ③ detach 后重新 watch 必须能再订阅（否则下次 attach 永远收不到对话框事件）。
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

const send = vi.fn<(tabId: number, method: string, params?: Record<string, unknown>) => Promise<unknown>>()
const subscribeEvents = vi.fn<(tabId: number, method: string, cb: (params: unknown) => void) => void>()
const unsubscribeEvents = vi.fn<(tabId: number, method: string, cb: (params: unknown) => void) => void>()
const ensurePageDomain = vi.fn<(tabId: number) => Promise<void>>()

vi.mock('./cdp', () => ({
  send: (tabId: number, method: string, params?: Record<string, unknown>) => send(tabId, method, params),
  subscribeEvents: (tabId: number, method: string, cb: (params: unknown) => void) => subscribeEvents(tabId, method, cb),
  unsubscribeEvents: (tabId: number, method: string, cb: (params: unknown) => void) =>
    unsubscribeEvents(tabId, method, cb),
}))
vi.mock('./cdp-commands', () => ({ensurePageDomain: (tabId: number) => ensurePageDomain(tabId)}))

const {decideDialog, dropDialogWatch, watchDialogs} = await import('./dialog.js')
const {peekPendingDialog, setPendingDialog} = await import('./dialog-state.js')

const TAB = 7

function openedCb(method: string): (params: unknown) => void {
  const call = subscribeEvents.mock.calls.find((entry) => entry[1] === method)
  if (call === undefined) throw new Error(`no subscription registered for ${method}`)
  return call[2]
}

beforeEach(() => {
  // 先拆上一次用例遗留的订阅，再清计数（否则 dropDialogWatch 的调用会污染断言）
  dropDialogWatch(TAB)
  vi.clearAllMocks()
  send.mockResolvedValue({})
  ensurePageDomain.mockResolvedValue(undefined)
})

describe('watchDialogs', () => {
  test('records the opening dialog and clears it when the browser reports it closed', () => {
    watchDialogs(TAB)
    expect(ensurePageDomain).toHaveBeenCalledWith(TAB)
    openedCb('Page.javascriptDialogOpening')({
      type: 'beforeunload',
      message: 'Changes you made may not be saved.',
      url: 'https://x.test/a',
    })
    expect(peekPendingDialog(TAB)).toMatchObject({
      type: 'beforeunload',
      message: 'Changes you made may not be saved.',
      url: 'https://x.test/a',
    })
    openedCb('Page.javascriptDialogClosed')({result: true})
    expect(peekPendingDialog(TAB)).toBeUndefined()
  })

  test('is idempotent per tab and re-subscribes after a detach', () => {
    watchDialogs(TAB)
    watchDialogs(TAB)
    expect(subscribeEvents).toHaveBeenCalledTimes(2)

    dropDialogWatch(TAB)
    expect(unsubscribeEvents).toHaveBeenCalledTimes(2)
    expect(peekPendingDialog(TAB)).toBeUndefined()

    watchDialogs(TAB)
    expect(subscribeEvents).toHaveBeenCalledTimes(4)
  })

  test('a failed Page.enable is retried on the next call instead of silently watching nothing', async () => {
    ensurePageDomain.mockRejectedValueOnce(new Error('not attached'))
    watchDialogs(TAB)
    await Promise.resolve()
    await Promise.resolve()
    expect(peekPendingDialog(TAB)).toBeUndefined()
    watchDialogs(TAB)
    expect(subscribeEvents).toHaveBeenCalledTimes(4)
  })
})

describe('decideDialog', () => {
  test('sends the accept flag and returns the dialog it saw', async () => {
    setPendingDialog(TAB, {type: 'confirm', message: 'Delete row?', openedAt: 1})
    await expect(decideDialog(TAB, true)).resolves.toMatchObject({handled: true, dialog: {type: 'confirm'}})
    expect(send).toHaveBeenCalledWith(TAB, 'Page.handleJavaScriptDialog', {accept: true})
    expect(peekPendingDialog(TAB)).toBeUndefined()
  })

  test('passes promptText only when supplied', async () => {
    await decideDialog(TAB, true, '张三')
    expect(send).toHaveBeenCalledWith(TAB, 'Page.handleJavaScriptDialog', {accept: true, promptText: '张三'})
    send.mockClear()
    await decideDialog(TAB, false)
    expect(send).toHaveBeenCalledWith(TAB, 'Page.handleJavaScriptDialog', {accept: false})
  })

  test('handles a dialog that survived an SW restart (no local state) as handled:true', async () => {
    await expect(decideDialog(TAB, true)).resolves.toEqual({handled: true})
  })

  test('"No dialog is showing" means handled:false, not an error', async () => {
    send.mockRejectedValueOnce(new Error('{"code":-32000,"message":"No dialog is showing"}'))
    await expect(decideDialog(TAB, false)).resolves.toEqual({handled: false})
  })

  test('other CDP failures propagate instead of being reported as "no dialog"', async () => {
    send.mockRejectedValueOnce(new Error('debugger session was lost; retry the tool call to re-attach'))
    await expect(decideDialog(TAB, false)).rejects.toThrow(/session was lost/)
  })
})
