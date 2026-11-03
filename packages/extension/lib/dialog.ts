/**
 * 原生对话框（alert / confirm / prompt / beforeunload）的订阅与处理。
 *
 * 为什么必须走 CDP：这类对话框是浏览器 UI，不在 DOM / AX 树里，snapshot / get_text /
 * click 都看不见也点不到；对话框打开期间渲染进程被阻塞，其余工具只能等超时。
 * Page.javascriptDialogOpening 让我们知道「谁开着」，Page.handleJavaScriptDialog 唯一地
 * 接受 / 取消它。
 *
 * attach 后立即 watchDialogs：事件只在 Page domain enabled 时派发，等到真出对话框再订阅就已经晚了。
 */
import {send, subscribeEvents, unsubscribeEvents} from './cdp'
import {ensurePageDomain} from './cdp-commands'
import {isNoDialogError} from './cdp-errors'
import {clearPendingDialog, peekPendingDialog, setPendingDialog} from './dialog-state'
import type {PendingDialog} from './dialog-state'

interface DialogSub {
  readonly method: string
  readonly cb: (params: unknown) => void
}

/** tabId → 本会话已注册的订阅（幂等 + detach 时可精确拆除）。 */
const watches = new Map<number, readonly DialogSub[]>()

function onOpen(tabId: number, raw: unknown): void {
  const params = raw as {type?: string; message?: string; url?: string; defaultPrompt?: string}
  setPendingDialog(tabId, {
    type: params.type ?? 'alert',
    message: params.message ?? '',
    ...(params.url !== undefined ? {url: params.url} : {}),
    ...(params.defaultPrompt !== undefined ? {defaultPrompt: params.defaultPrompt} : {}),
    openedAt: Date.now(),
  })
}

/** 幂等：每个会话只订阅一次，并确保 Page domain 打开。 */
export function watchDialogs(tabId: number): void {
  if (watches.has(tabId)) return
  const subs: DialogSub[] = [
    {method: 'Page.javascriptDialogOpening', cb: (raw) => onOpen(tabId, raw)},
    {method: 'Page.javascriptDialogClosed', cb: () => clearPendingDialog(tabId)},
  ]
  for (const sub of subs) subscribeEvents(tabId, sub.method, sub.cb)
  watches.set(tabId, subs)
  void ensurePageDomain(tabId).catch((error: unknown) => {
    // enable 失败就撤销记忆，下次工具调用重试（否则会永久认为「已在看」）
    console.warn('[dialog] enabling Page domain failed:', error instanceof Error ? error.message : error)
    dropDialogWatch(tabId)
  })
}

/** detach / tab 关闭时拆除订阅与状态（下次 attach 重新 watch）。 */
export function dropDialogWatch(tabId: number): void {
  for (const sub of watches.get(tabId) ?? []) unsubscribeEvents(tabId, sub.method, sub.cb)
  watches.delete(tabId)
  clearPendingDialog(tabId)
}

export interface DialogOutcome {
  readonly handled: boolean
  /** 处理前的本地记录（SW 重启后可能缺省，但命令仍可能成功）。 */
  readonly dialog?: PendingDialog
}

/**
 * 处理对话框。总是先发命令再看结果：
 * 本地状态可能是空的（SW 重启）而对话框其实还开着，此时只有 CDP 的报错能说明「真没有」。
 */
export async function decideDialog(tabId: number, accept: boolean, promptText?: string): Promise<DialogOutcome> {
  const dialog = peekPendingDialog(tabId)
  try {
    await send(tabId, 'Page.handleJavaScriptDialog', {
      accept,
      ...(promptText !== undefined ? {promptText} : {}),
    })
  } catch (error) {
    if (isNoDialogError(error)) {
      clearPendingDialog(tabId)
      return {handled: false}
    }
    throw error
  }
  clearPendingDialog(tabId)
  return dialog !== undefined ? {handled: true, dialog} : {handled: true}
}
