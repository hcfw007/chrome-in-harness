/**
 * 每个 tab 当前挂着的原生对话框状态（alert / confirm / prompt / beforeunload）。
 *
 * 纯状态模块，零依赖：lib/cdp.ts 的发送守卫与 lib/dialog.ts 的事件订阅都读它，
 * 拆出来是为了避免 cdp ↔ dialog 循环 import。
 * 一个 tab 同时只可能有一个 JS 对话框，故用单值而非队列。
 */

export interface PendingDialog {
  /** CDP 的 dialog type：alert / confirm / prompt / beforeunload。 */
  readonly type: string
  /** 对话框正文（beforeunload 的文案由 Chrome 决定，可能为空串）。 */
  readonly message: string
  /** 触发该对话框的页面 URL。 */
  readonly url?: string
  /** prompt 的默认输入值。 */
  readonly defaultPrompt?: string
  readonly openedAt: number
}

const pending = new Map<number, PendingDialog>()

export function setPendingDialog(tabId: number, dialog: PendingDialog): void {
  pending.set(tabId, dialog)
}

export function peekPendingDialog(tabId: number): PendingDialog | undefined {
  return pending.get(tabId)
}

export function clearPendingDialog(tabId: number): void {
  pending.delete(tabId)
}
