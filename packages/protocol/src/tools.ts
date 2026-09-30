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
  SCRIPT_REJECTED: 'SCRIPT_REJECTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
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

/**
 * 坐标点击：ref 无法命中时（iframe/Canvas/无 ref 的 icon-only 容器等）的兜底。
 * 坐标是视口 CSS 像素；必须显式传 `coordinates: true` 作为意图标记。
 */
export const clickAtParams = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  coordinates: z.literal(true),
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

// ---- P3：调试读取 / 等待 / 运行时白名单授权 ----

export const CONSOLE_LEVELS = ['error', 'warning', 'info', 'all'] as const

export const readConsoleParams = z.object({
  level: z.enum(CONSOLE_LEVELS).optional(),
  clear: z.boolean().optional(),
  ...tabIdField,
})

export const consoleEntrySchema = z.object({
  level: z.enum(['error', 'warning', 'info']),
  text: z.string(),
  timestamp: z.number(),
})

export const readConsoleResult = z.object({
  entries: z.array(consoleEntrySchema),
})

export const readNetworkParams = z.object({
  urlFilter: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  ...tabIdField,
})

export const networkEntrySchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().optional(),
  mimeType: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.number(),
})

export const readNetworkResult = z.object({
  entries: z.array(networkEntrySchema),
})

/** 三条件恰传其一：raw shape 给 server 注册 inputSchema，refine 后的给 extension 校验。 */
export const waitParamsShape = {
  text: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  urlContains: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  ...tabIdField,
}

export const waitParams = z.object(waitParamsShape).refine(
  (p) => [p.text, p.selector, p.urlContains].filter((v) => v !== undefined).length === 1,
  {message: 'exactly one of text / selector / urlContains is required'},
)

export const waitResult = z.object({
  matched: z.boolean(),
  timedOut: z.boolean(),
})

export const addAllowlistDomainParams = z.object({
  domain: z.string().min(1),
})

export const addAllowlistDomainResult = z.object({
  domains: z.array(z.string()),
})

// ---- Phase 3b：受限 evaluateScript + 权限弹窗授权 ----

export const SCRIPT_MAX_LENGTH = 8_000

export const evaluateScriptParams = z.object({
  expression: z.string().min(1).max(SCRIPT_MAX_LENGTH),
  awaitPromise: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  ...tabIdField,
})

export const evaluateScriptResult = z.object({
  value: z.unknown(),
  type: z.string(),
  truncated: z.boolean(),
})

export const requestPermissionParams = z.object({
  domain: z.string().min(1),
})

export const requestPermissionResult = z.object({
  granted: z.boolean(),
  domains: z.array(z.string()),
})

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
  'read_console',
  'read_network',
  'wait',
  'add_allowlist_domain',
  'evaluate_script',
  'request_permission',
  'click_at',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

