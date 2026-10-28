/** CDP 返回值 → 可回传 JSON 值的规整（纯逻辑）。超限截断并标记原始长度。 */

import {MAX_EVALUATE_CHARS} from '@chrome-in-harness/protocol'

/** 字符串与对象共用同一上限：此前字符串单独卡 1000 字符，导致长文本被截而拆成数组却能完整取回。 */
export const MAX_RESULT_JSON = MAX_EVALUATE_CHARS

export interface SerializedValue {
  readonly value: string
  readonly type: string
  readonly truncated: boolean
  /** 截断时的原始字符数（字符串为原文长度，对象为 JSON 长度）。 */
  readonly originalLength?: number
}

function clip(text: string, type: string): SerializedValue {
  if (text.length <= MAX_RESULT_JSON) return {value: text, type, truncated: false}
  return {value: `${text.slice(0, MAX_RESULT_JSON)}…`, type, truncated: true, originalLength: text.length}
}

export function serializeValue(raw: unknown): SerializedValue {
  const type = typeof raw
  if (raw === undefined) return {value: 'undefined', type: 'undefined', truncated: false}
  if (raw === null) return {value: 'null', type: 'object', truncated: false}
  if (type === 'string') return clip(raw as string, 'string')
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return {value: String(raw), type, truncated: false}
  }
  let json: string
  try {
    json = JSON.stringify(raw)
  } catch {
    json = String(raw)
  }
  return clip(json, 'object')
}
