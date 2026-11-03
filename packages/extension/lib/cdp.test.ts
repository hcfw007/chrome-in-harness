/**
 * cdp.send 的对话框守卫：对话框开着时渲染进程被阻塞，除白名单命令外一律快速失败，
 * 而不是让调用方干等到 TOOL_TIMEOUT（模型无从得知「页面被一个看不见的对话框卡住」）。
 */
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

const TAB = 11

const {send} = await import('./cdp.js')
const {clearPendingDialog, setPendingDialog} = await import('./dialog-state.js')

const sentMethods: string[] = []

/** 最小 chrome.debugger 桩：getTargets 报告已 attach，避免真实 attach 流程。 */
function installChrome(): void {
  sentMethods.length = 0
  ;(globalThis as unknown as {chrome: unknown}).chrome = {
    runtime: {},
    debugger: {
      getTargets: async () => [{tabId: TAB, attached: true}],
      sendCommand: (_target: unknown, method: string, _params: unknown, cb: (result?: object) => void) => {
        sentMethods.push(method)
        cb({})
      },
      attach: (_target: unknown, _version: string, cb: () => void) => cb(),
      detach: (_target: unknown, cb: () => void) => cb(),
      onEvent: {addListener: () => {}},
      onDetach: {addListener: () => {}},
    },
  }
}

beforeEach(() => {
  installChrome()
  clearPendingDialog(TAB)
})

afterEach(() => {
  clearPendingDialog(TAB)
})

describe('send dialog guard', () => {
  test('blocks renderer-bound commands with a DIALOG_OPEN error and sends nothing', async () => {
    setPendingDialog(TAB, {type: 'beforeunload', message: 'Changes you made may not be saved.', openedAt: 1})
    await expect(send(TAB, 'Runtime.evaluate', {expression: '1'})).rejects.toThrow(/^DIALOG_OPEN:/)
    expect(sentMethods).toEqual([])
  })

  test('the error names the dialog type, its text, and the way out', async () => {
    setPendingDialog(TAB, {type: 'confirm', message: 'Delete row?', openedAt: 1})
    let error: Error | undefined
    try {
      await send(TAB, 'Accessibility.getFullAXTree')
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught))
    }
    expect(error?.message).toContain('confirm dialog')
    expect(error?.message).toContain('Delete row?')
    expect(error?.message).toContain('handle_dialog({accept: true})')
  })

  test('still lets handleJavaScriptDialog through (otherwise the dialog could never be resolved)', async () => {
    setPendingDialog(TAB, {type: 'alert', message: 'hi', openedAt: 1})
    await expect(send(TAB, 'Page.handleJavaScriptDialog', {accept: true})).resolves.toEqual({})
    expect(sentMethods).toEqual(['Page.handleJavaScriptDialog'])
  })

  test('sends normally once the dialog is cleared', async () => {
    clearPendingDialog(TAB)
    await expect(send(TAB, 'Runtime.evaluate', {expression: '1'})).resolves.toEqual({})
    expect(sentMethods).toEqual(['Runtime.evaluate'])
  })
})
