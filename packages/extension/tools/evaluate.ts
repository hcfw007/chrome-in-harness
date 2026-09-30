/**
 * evaluate_script 工具：在目标 tab 的页面上下文里执行受限 JS 并返回 JSON 值。
 * 受限边界见 lib/script-guard.ts（黑名单 + 顶层形态校验）。
 * 执行走 CDP Runtime.evaluate（复用 wait 的同一条路径），结果按 JSON 序列化并截断。
 */

import {TOOL_ERROR_CODES} from '@chrome-in-harness/protocol'
import {ensureAttached} from '../lib/cdp'
import {evaluateJson} from '../lib/cdp-commands'
import {guardScript} from '../lib/script-guard'
import {serializeValue} from '../lib/serialize'
import {toolError} from './access'
import {authorizeTab} from './access'

import type {ToolHandler} from './types'

const DEFAULT_TIMEOUT_MS = 15_000

interface EvaluateParams {
  readonly expression: string
  readonly awaitPromise?: boolean
  readonly timeoutMs?: number
  readonly tabId?: number
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export const evaluateScript: ToolHandler = async (rawParams) => {
  const params = rawParams as EvaluateParams
  const target = await authorizeTab(params.tabId)
  await ensureAttached(target.tabId)

  const guarded = guardScript(params.expression, params.awaitPromise === true)
  if (!guarded.ok) {
    throw toolError(TOOL_ERROR_CODES.SCRIPT_REJECTED, guarded.reason)
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const expression = params.expression

  let value: unknown
  try {
    if (params.awaitPromise === true) {
      value = await withTimeout(
        evaluateJson<unknown>(target.tabId, `(async () => { return ${expression}; })()`),
        timeoutMs,
        `evaluate_script timed out after ${timeoutMs}ms`,
      )
    } else {
      value = await withTimeout(
        evaluateJson<unknown>(target.tabId, expression),
        timeoutMs,
        `evaluate_script timed out after ${timeoutMs}ms`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw toolError(TOOL_ERROR_CODES.SCRIPT_REJECTED, message)
  }

  const {value: serialized, type, truncated} = serializeValue(value)
  return {value: serialized, type, truncated}
}
