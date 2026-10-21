/**
 * 页面脚本数值插值的最后一道闸（纯逻辑）。
 * 数值会被原样拼进注入页面的脚本文本；非 number（如 run_actions 透传的字符串）
 * 一旦拼进去就是任意 JS，可绕过 evaluate_script 的脚本守卫。只认 typeof number，不做强制转换。
 */
export function scriptNumber(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number (got ${typeof value})`)
  }
  return value
}
