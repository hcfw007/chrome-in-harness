import {runActionsParams, runActionsResult} from '@chrome-in-harness/protocol'
import {callBridge, defineTool, toolText} from './types.js'
import type {ToolDef} from './types.js'

/** 单步结果摘要上限：避免把快照/脚本返回值整块回灌进批量结果。 */
const MAX_STEP_TEXT = 300

function summarize(result: unknown): string {
  if (result === undefined || result === null) return ''
  const json = typeof result === 'string' ? result : JSON.stringify(result)
  if (json === undefined || json === '{}' || json === '') return ''
  return ` — ${json.length > MAX_STEP_TEXT ? `${json.slice(0, MAX_STEP_TEXT)}…` : json}`
}

const runActions = defineTool({
  name: 'run_actions',
  title: 'Run a sequence of browser actions',
  description: '',
  schema: runActionsParams.shape,
  async run(args, call) {
    const result = await callBridge(call, 'run_actions', args, runActionsResult)
    const lines = result.steps.map((step) => {
      const status = step.ok ? `ok${summarize(step.result)}` : `failed: ${step.error ?? 'unknown error'}`
      return `${step.index + 1}. ${step.tool} ${status}`
    })
    return toolText(lines.join('\n'))
  },
})

export const BATCH_TOOL_DEFS: readonly ToolDef[] = [runActions]
