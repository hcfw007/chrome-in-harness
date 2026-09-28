/**
 * Phase 2 工具契约：参数/结果的 zod schema 与错误码常量。
 * server 取 params 的 .shape 注册 MCP inputSchema；extension 在 dispatch 边界
 * 用同一份定义 safeParse —— 两端永不漂移。
 */
import {z} from 'zod'

/** ref 编号格式：e1、e2、…（快照 DFS 前序编号）。 */
export const REF_PATTERN = /^e[1-9]\d*$/

export const TAB_ID = z.number().int().positive()

/** extension 侧拼进错误消息前缀（"CODE: message"），server 原样透传供模型自纠。 */
export const TOOL_ERROR_CODES = {
  DOMAIN_NOT_ALLOWED: 'DOMAIN_NOT_ALLOWED',
  TAB_NOT_MANAGED: 'TAB_NOT_MANAGED',
  STALE_REF: 'STALE_REF',
  NO_SNAPSHOT: 'NO_SNAPSHOT',
  DEBUGGER_BUSY: 'DEBUGGER_BUSY',
} as const

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES]

const tabIdField = {tabId: TAB_ID.optional()} as const

export const navigateParams = z.object({
  url: z.string().url(),
  ...tabIdField,
})

export const snapshotParams = z.object(tabIdField)

export const clickParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  ...tabIdField,
})

export const hoverParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  ...tabIdField,
})

export const typeParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  text: z.string().min(1).max(10_000),
  submit: z.boolean().optional(),
  ...tabIdField,
})

export const scrollParams = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().int().positive().max(5000).optional(),
  ref: z.string().regex(REF_PATTERN).optional(),
  ...tabIdField,
})

export const screenshotParams = z.object(tabIdField)

export const tabListParams = z.object({})

export const tabNewParams = z.object({
  url: z.string().url().optional(),
})

export const tabSelectParams = z.object({tabId: TAB_ID})

export const tabCloseParams = z.object({tabId: TAB_ID})

// ---- 结果 schema：WS 返回值是 unknown，server 侧按边界输入二次校验 ----

export const navigateResult = z.object({
  url: z.string(),
  title: z.string().optional(),
  loaded: z.boolean(),
})

export const snapshotResult = z.object({
  snapshot: z.string(),
  version: z.number().int(),
  url: z.string(),
  truncated: z.boolean(),
})

export const screenshotResult = z.object({
  data: z.string(), // base64 PNG
  mimeType: z.literal('image/png'),
})

export interface TabSummary {
  readonly tabId: number
  readonly title: string
  readonly url: string
  readonly active: boolean
}

export const tabListResult = z.object({
  tabs: z.array(
    z.object({
      tabId: z.number().int(),
      title: z.string(),
      url: z.string(),
      active: z.boolean(),
    }),
  ),
})

export const okResult = z.object({})

/** 全部工具名，extension 注册与 server 注册共用，防两端名字漂移。 */
export const TOOL_NAMES = [
  'ping',
  'navigate',
  'snapshot',
  'click',
  'hover',
  'type',
  'scroll',
  'screenshot',
  'tab_list',
  'tab_new',
  'tab_select',
  'tab_close',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

