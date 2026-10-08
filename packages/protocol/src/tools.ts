/**
 * Phase 2 工具契约：参数/结果的 zod schema 与错误码常量。
 * server 取 params 的 .shape 注册 MCP inputSchema；extension 在 dispatch 边界
 * 用同一份定义 safeParse —— 两端永不漂移。
 */
import {z} from 'zod'

/**
 * ref 编号格式：`e<N>-<token>`（如 e3-a7k2）。token 编码 worker 代数 + 快照版本，
 * SW 重启/快照更替后旧 ref 一律显式 STALE_REF，杜绝静默错点。
 * 兼容：无 token 的裸 `e<N>` 仍可通过 schema（旧会话缓存），但 extension 侧会显式拒绝。
 */
export const REF_PATTERN = /^e[1-9]\d*(-[a-z0-9]{2,12})?$/

export const TAB_ID = z.number().int().positive()

/** extension 侧拼进错误消息前缀（"CODE: message"），server 原样透传供模型自纠。 */
export const TOOL_ERROR_CODES = {
  DOMAIN_NOT_ALLOWED: 'DOMAIN_NOT_ALLOWED',
  TAB_NOT_MANAGED: 'TAB_NOT_MANAGED',
  STALE_REF: 'STALE_REF',
  NO_SNAPSHOT: 'NO_SNAPSHOT',
  DEBUGGER_BUSY: 'DEBUGGER_BUSY',
  SCRIPT_REJECTED: 'SCRIPT_REJECTED',
  SCRIPT_ERROR: 'SCRIPT_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WINDOW_NOT_INTERACTIVE: 'WINDOW_NOT_INTERACTIVE',
} as const

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES]

/** 快照文本默认字符上限（与 extension 的 MAX_CHARS 保持一致）。 */
export const MAX_SNAPSHOT_CHARS = 60_000

const tabIdField = {tabId: TAB_ID.optional()} as const

/** 键盘修饰键（press_key / click_at / type 共用）。 */
export const INPUT_MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const
export const inputModifiersSchema = z.array(z.enum(INPUT_MODIFIERS)).max(4)

export const navigateParams = z.object({
  url: z.string().url(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  ...tabIdField,
})

export const snapshotParams = z.object({
  /** 按 role/name 大小写不敏感正则过滤：交互命中在前（连子树），纯文本命中只留一行。 */
  query: z.string().min(1).max(200).optional(),
  /** 只输出该 ref 指向节点的子树。 */
  rootRef: z.string().regex(REF_PATTERN).optional(),
  /** 快照文本的字符预算（覆盖默认 60KB）。 */
  limit: z.number().int().positive().max(MAX_SNAPSHOT_CHARS).optional(),
  ...tabIdField,
})

export const clickParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  ...tabIdField,
})

/**
 * 坐标点击：ref 无法命中时（iframe/Canvas/无 ref 的 icon-only 容器等）的兜底。
 * 坐标是视口 CSS 像素；必须显式传 `coordinates: true` 作为意图标记。
 * button 支持左/中/右键；clickCount 支持双击/三击；modifiers 支持组合键。
 */
export const clickAtParams = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  coordinates: z.literal(true),
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  modifiers: inputModifiersSchema.optional(),
  ...tabIdField,
})

export const hoverParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  ...tabIdField,
})

export const pressKeyParams = z.object({
  /** 键名（Enter/Backspace/Escape/Tab/Home/End/ArrowUp…/F1-F12）或单个字符（a、A、!、空格）。 */
  key: z.string().min(1).max(24),
  modifiers: inputModifiersSchema.optional(),
  /** 先把该 ref 元素滚进视野并聚焦，再按键；缺省则向当前焦点元素按键。 */
  ref: z.string().regex(REF_PATTERN).optional(),
  ...tabIdField,
})

/**
 * type：默认行为与旧版完全一致（点击 ref 元素中心 → Input.insertText → submit 时按 Enter）。
 * mode='verbatim' 一次性整段插入且拒绝 submit（避免 Monaco 自动缩进/括号自动补全）；
 * clear=true 输入前先 Ctrl+A + Delete 清空；focus='none' 跳过隐式点击。
 */
export const typeParams = z.object({
  ref: z.string().regex(REF_PATTERN).optional(),
  text: z.string().min(1).max(10_000),
  submit: z.boolean().optional(),
  mode: z.enum(['insert', 'verbatim']).optional(),
  clear: z.boolean().optional(),
  focus: z.enum(['none', 'click-ref']).optional(),
  ...tabIdField,
})

export const typeResult = z.object({
  /** 实际使用的输入模式。 */
  mode: z.enum(['insert', 'verbatim']),
  /** 插入文本里的换行数（0 = 单行插入）。 */
  insertedLines: z.number().int().min(0),
  /** 输入后的光标落点（1-based line/col）；焦点不在可编辑元素或缺 Monaco API 时缺省。 */
  insertionPoint: z
    .object({line: z.number().int().min(1), col: z.number().int().min(1)})
    .optional(),
})

export const getTextParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  ...tabIdField,
})

export const getTextResult = z.object({
  text: z.string(),
  truncated: z.boolean(),
})

export const takeoverTabParams = z.object({tabId: TAB_ID})

export const takeoverTabResult = z.object({
  tabId: z.number().int(),
  url: z.string(),
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

/** 四条件恰传其一：raw shape 给 server 注册 inputSchema，refine 后的给 extension 校验。 */
export const waitParamsShape = {
  text: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  urlContains: z.string().min(1).optional(),
  /** Monaco 类编辑器渲染完成：存在高度 > 40px 的 .monaco-editor 且其内有非空 view-line。 */
  editorRendered: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  ...tabIdField,
}

export const waitParams = z.object(waitParamsShape).refine(
  (p) => [p.text, p.selector, p.urlContains, p.editorRendered].filter((v) => v !== undefined).length === 1,
  {message: 'exactly one of text / selector / urlContains / editorRendered is required'},
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
  waitUntil: z.string().optional(),
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
      /** 所属 tab group id；无组为 null。 */
      groupId: z.number().int().nullable(),
      /** 是否在受管的 Chrome in Harness 组内（可用于判断复用是否生效）。 */
      managed: z.boolean(),
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
  'press_key',
  'scroll',
  'screenshot',
  'tab_list',
  'tab_new',
  'tab_select',
  'tab_close',
  'takeover_tab',
  'read_console',
  'read_network',
  'wait',
  'add_allowlist_domain',
  'evaluate_script',
  'request_permission',
  'click_at',
  'get_text',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

