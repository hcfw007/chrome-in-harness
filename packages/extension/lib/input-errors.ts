/**
 * 输入类工具（type / press_key）的落盘失败报文（纯逻辑）。
 *
 * 报文必须如实说明「失败时已经发出了什么」：输入前失败才能说没发；点击已派发、
 * 文本未输入要说清点击已发；文本已发后的校验失败只能说「可能部分落盘」。
 * 调用方据此判断能否安全重试——误报「未发送」会让模型重发，造成重复提交。
 */
import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'

/** 失败发生时已派发的输入：none = 什么都没发；click = 只发了聚焦点击；text = 文本/按键已发。 */
export type InputPhase = 'none' | 'click' | 'text'

const SENT: Record<InputPhase, string> = {
  none: 'No input was sent.',
  click: 'A focusing click was dispatched, but no text or keys were sent.',
  text: 'Input WAS sent and may have landed partially or elsewhere — read the field back before retrying; do not resend blindly.',
}

export function inputNotLanded(reason: string, phase: InputPhase, next: string): Error {
  return new Error(`${TOOL_ERROR_CODES.INPUT_NOT_LANDED}: ${reason}. ${SENT[phase]} ${next}`)
}

/** DOM.scrollIntoViewIfNeeded / getBoxModel：元素无布局（display:none、已移出渲染树）。 */
export class NotRenderedError extends Error {}

/** DOM.focus：元素不可聚焦（disabled、inert、不可编辑的普通元素）。 */
export class NotFocusableError extends Error {}

const RETRY_VISIBLE = 'Make the target visible and enabled (e.g. switch to its tab), take a new snapshot, then retry with the fresh ref.'

/**
 * 输入前阶段（尚未派发任何输入）的错误统一映射为 INPUT_NOT_LANDED。
 * 其余错误（STALE_REF、ELEMENT_COVERED 等已带码的）原样返回。
 */
export function mapTargetError(error: unknown, ref: string): unknown {
  if (error instanceof NotRenderedError) {
    return inputNotLanded(`${ref} is not rendered (display:none, collapsed, or removed)`, 'none', RETRY_VISIBLE)
  }
  if (error instanceof NotFocusableError) {
    return inputNotLanded(`${ref} cannot receive focus (disabled, inert, or not an editable element)`, 'none', RETRY_VISIBLE)
  }
  return error
}

export function notFocusedError(ref: string): Error {
  return inputNotLanded(
    `${ref} did not receive focus (it may be hidden, e.g. in an inactive tab/iframe, or focus was taken elsewhere)`,
    'none',
    RETRY_VISIBLE,
  )
}

/** 点击后焦点落到了 ref 所在 frame 以外（被别的 iframe 盖住、点击被截走）：已发点击，未输入。 */
export function focusInOtherFrameError(ref: string, landed: string | null): Error {
  return inputNotLanded(
    `after clicking ${ref}, focus is in a different frame${landed !== null ? ` (${landed})` : ''}`,
    'click',
    'Another element (often another iframe) is over the target. Bring the target to the front, take a new snapshot, then retry.',
  )
}
