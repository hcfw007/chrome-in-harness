/** CDP 返回值 → 可回传 JSON 值的规整（纯逻辑）。超限截断并标记。 */

export const MAX_RESULT_JSON = 200_000
const MAX_STRING = 1_000

export interface SerializedValue {
  readonly value: string
  readonly type: string
  readonly truncated: boolean
}

export function serializeValue(raw: unknown): SerializedValue {
  const type = typeof raw
  if (raw === undefined) return {value: 'undefined', type: 'undefined', truncated: false}
  if (raw === null) return {value: 'null', type: 'object', truncated: false}
  if (type === 'string') {
    const text = raw as string
    return text.length > MAX_STRING
      ? {value: `${text.slice(0, MAX_STRING)}…`, type: 'string', truncated: true}
      : {value: text, type: 'string', truncated: false}
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return {value: String(raw), type, truncated: false}
  }
  let json: string
  try {
    json = JSON.stringify(raw)
  } catch {
    json = String(raw)
  }
  if (json.length > MAX_RESULT_JSON) {
    return {value: `${json.slice(0, MAX_RESULT_JSON)}…`, type: 'object', truncated: true}
  }
  return {value: json, type: 'object', truncated: false}
}
