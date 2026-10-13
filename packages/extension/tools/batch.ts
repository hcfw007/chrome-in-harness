/**
 * 批量执行：一次调用按顺序跑多个已注册工具，减少 MCP 往返。
 * 每步都走 registry.invoke，因此鉴权/组状态/ref 校验与单独调用完全一致。
 * 默认在首个失败处停止；continueOnError=true 时继续并保留每步错误。
 */
import {runActionsParams} from '@chrome-in-harness/protocol'

import {invoke} from './registry'

import type {ToolHandler} from './types'

interface StepResult {
  index: number
  tool: string
  ok: boolean
  result?: unknown
  error?: string
}

/** 顶层 tabId 只在步骤自身没给 tabId 时注入。 */
function withDefaultTabId(params: Record<string, unknown> | undefined, tabId: number | undefined): Record<string, unknown> {
  const base = params ?? {}
  if (tabId === undefined || base['tabId'] !== undefined) return base
  return {...base, tabId}
}

export const runActions: ToolHandler = async (params) => {
  const raw = runActionsParams.parse(params)
  const steps: StepResult[] = []
  for (const [index, step] of raw.actions.entries()) {
    try {
      const result = await invoke(step.tool, withDefaultTabId(step.params, raw.tabId))
      steps.push({index, tool: step.tool, ok: true, result})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      steps.push({index, tool: step.tool, ok: false, error: message})
      if (raw.continueOnError !== true) break
    }
  }
  return {steps}
}
