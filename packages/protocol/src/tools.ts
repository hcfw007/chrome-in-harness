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
  DOMAIN_CONFIRMATION_REQUIRED: 'DOMAIN_CONFIRMATION_REQUIRED',
  TAB_NOT_MANAGED: 'TAB_NOT_MANAGED',
  STALE_REF: 'STALE_REF',
  NO_SNAPSHOT: 'NO_SNAPSHOT',
  DEBUGGER_BUSY: 'DEBUGGER_BUSY',
  SCRIPT_REJECTED: 'SCRIPT_REJECTED',
  SCRIPT_ERROR: 'SCRIPT_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WINDOW_NOT_INTERACTIVE: 'WINDOW_NOT_INTERACTIVE',
  /** 键盘通路死亡（窗口 resize/失焦后 CDP 按键事件不再送达页面）。 */
  KEY_PIPELINE_DEAD: 'KEY_PIPELINE_DEAD',
  /** 焦点不在可编辑元素上，输入的文本不会落盘（type 显式报错而非静默成功）。 */
  INPUT_NOT_LANDED: 'INPUT_NOT_LANDED',
  /** 目标 tab 已关闭（常见于会话间隔后沿用旧 tabId）——开新 tab 或改用现存 tab。 */
  TAB_CLOSED: 'TAB_CLOSED',
  /** takeover 目标在用户自建的其他分组里：不擅自拆用户的分组，请用户先移出。 */
  TAB_IN_USER_GROUP: 'TAB_IN_USER_GROUP',
  /** server 侧：扩展未连接 / 调用中途断开（浏览器未开、扩展被禁用或 SW 正在重启）。 */
  EXTENSION_DISCONNECTED: 'EXTENSION_DISCONNECTED',
  /** server 侧：扩展在超时内未回包。 */
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
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
  /** 快照文本的字符预算（覆盖默认 60KB）；不是节点数。 */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_SNAPSHOT_CHARS)
    .optional()
    .describe('Output CHARACTER budget for the snapshot text (default 60000) — not a node count. Values below ~2000 usually show only a few nodes.'),
  ...tabIdField,
})

export const clickParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  /** true 时点击后等渲染静置，再返回一份新快照（省一次 snapshot 往返）。 */
  snapshot: z.boolean().optional(),
  ...tabIdField,
})

/**
 * 坐标点击：ref 无法命中时（iframe/Canvas/无 ref 的 icon-only 容器等）的兜底。
 * 坐标默认是视口 CSS 像素；space='image' 时是本 tab 最近一次截图上的像素，由扩展换算。
 * 必须显式传 `coordinates: true` 作为意图标记。
 * button 支持左/中/右键；clickCount 支持双击/三击；modifiers 支持组合键。
 */
export const clickAtParams = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  coordinates: z.literal(true),
  space: z.enum(['css', 'image']).optional(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  modifiers: inputModifiersSchema.optional(),
  ...tabIdField,
})

/**
 * hover：ref / selector / text / 坐标（x+y，视口 CSS 像素）四选一。
 * 无 ref 的纯图标元素（tooltip 触发器）用 selector 或坐标即可悬停。
 * shape 不带 refine（给 server 注册 inputSchema），hoverParams 带 refine（extension 校验）。
 */
export const hoverParamsShape = {
  ref: z.string().regex(REF_PATTERN).optional(),
  selector: z.string().min(1).max(500).optional(),
  text: z.string().min(1).max(200).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  ...tabIdField,
}

export function hoverParamsError(p: {ref?: unknown; selector?: unknown; text?: unknown; x?: unknown; y?: unknown}): string | undefined {
  if ((p.x === undefined) !== (p.y === undefined)) return 'pass x and y together'
  const count = [p.ref, p.selector, p.text, p.x].filter((v) => v !== undefined).length
  return count === 1 ? undefined : `pass exactly one of ref / selector / text / x+y (got ${count})`
}

export const hoverParams = z.object(hoverParamsShape).superRefine((p, ctx) => {
  const message = hoverParamsError(p)
  if (message !== undefined) ctx.addIssue({code: 'custom', message})
})

/** 实际悬停的视口 CSS 坐标与该点元素（坐标模式没有元素描述）。 */
export const hoverResult = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  tag: z.string().optional(),
  text: z.string().optional(),
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
 * mode='set' 走 monaco setValue 原子写整个缓冲（绕开键盘/焦点/IME 通路，窗口失焦也稳），
 * 此时 ref 可省（页面仅一个编辑器时自动选中）；
 * clear=true 输入前先全选（macOS Cmd+A，其余 Ctrl+A）+ Delete 清空，残留则报错；focus='none' 跳过隐式点击。
 */
export const typeParams = z.object({
  ref: z.string().regex(REF_PATTERN).optional(),
  text: z.string().min(1).max(10_000),
  submit: z.boolean().optional(),
  mode: z.enum(['insert', 'verbatim', 'set']).optional(),
  clear: z.boolean().optional(),
  focus: z.enum(['none', 'click-ref']).optional(),
  ...tabIdField,
})

export const typeResult = z.object({
  /** 实际使用的输入模式。 */
  mode: z.enum(['insert', 'verbatim', 'set']),
  /** 插入文本里的换行数（0 = 单行插入）。 */
  insertedLines: z.number().int().min(0),
  /** 输入后的光标落点（1-based line/col）；焦点不在可编辑元素或缺 Monaco API 时缺省。 */
  insertionPoint: z
    .object({line: z.number().int().min(1), col: z.number().int().min(1)})
    .optional(),
  /** mode="set" 时编辑器曾塌缩并被自动 layout() 恢复（resize 后 5×5 窄条的防御性自愈）。 */
  layoutRecovered: z.boolean().optional(),
  /** 输入后焦点元素的实际值（原生 input/textarea/contentEditable）；Monaco 或 submit 后缺省。 */
  value: z.string().optional(),
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
  /** 调用前已在受管组内（本次为空操作）。旧扩展不回传。 */
  alreadyManaged: z.boolean().optional(),
  /** 该 tab 是其窗口当前显示的页（用户正在看）：takeover 不切换焦点，但后续操作对用户可见。 */
  active: z.boolean().optional(),
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

/** url 仅用于创建；复用时不导航，避免打断已有页面状态。 */
export const ensureTabParams = z.object({
  ...tabIdField,
  url: z.string().url().optional(),
})

export const ensureTabResult = z.object({
  tabId: TAB_ID,
  url: z.string(),
  reused: z.boolean(),
  /** 传入的 tabId 已关闭、因而新建了替代 tab 时，原 tabId（调用方必须改存新 id）。 */
  replacedTabId: TAB_ID.optional(),
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
  /** 请求发出 → 响应头到达（或失败）的耗时；旧扩展不回传。 */
  durationMs: z.number().optional(),
})

export const readNetworkResult = z.object({
  entries: z.array(networkEntrySchema),
})

export const waitForResponseResult = z.object({
  matched: z.boolean(),
  timedOut: z.boolean(),
  entry: networkEntrySchema.optional(),
})

/**
 * 条件至多传一个：raw shape 给 server 注册 inputSchema，refine 后的给 extension 校验。
 * 不传条件 = 纯延迟（必须显式给 timeoutMs，避免误用成默认 8s 盲等）。
 */
export const waitParamsShape = {
  text: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  urlContains: z.string().min(1).optional(),
  /** Monaco 类编辑器渲染完成：存在高度 > 40px 的 .monaco-editor 且其内有非空 view-line。 */
  editorRendered: z.boolean().optional(),
  /** 网络静默：连续 500ms 无新请求（SPA 首屏取数/轮询间隙）。 */
  networkIdle: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  ...tabIdField,
}

export const WAIT_CONDITION_KEYS = ['text', 'selector', 'urlContains', 'editorRendered', 'networkIdle'] as const

export function countWaitConditions(p: Partial<Record<(typeof WAIT_CONDITION_KEYS)[number], unknown>>): number {
  return WAIT_CONDITION_KEYS.filter((key) => p[key] !== undefined).length
}

/** 校验失败时的文案（server 与 extension 共用）；合法返回 undefined。 */
export function waitParamsError(p: Partial<Record<(typeof WAIT_CONDITION_KEYS)[number] | 'timeoutMs', unknown>>): string | undefined {
  const count = countWaitConditions(p)
  if (count > 1) return `pass at most one of ${WAIT_CONDITION_KEYS.join(' / ')} (got ${count})`
  if (count === 0 && p.timeoutMs === undefined) {
    return `pass one of ${WAIT_CONDITION_KEYS.join(' / ')}, or only timeoutMs for a plain delay`
  }
  return undefined
}

export const waitParams = z.object(waitParamsShape).superRefine((p, ctx) => {
  const message = waitParamsError(p)
  if (message !== undefined) ctx.addIssue({code: 'custom', message})
})

export const waitResult = z.object({
  matched: z.boolean(),
  timedOut: z.boolean(),
})

/** 元素定位三选一（scroll_to / probe / get_html 共用）：ref、CSS selector 或可见文本。 */
const locatorFields = {
  ref: z.string().regex(REF_PATTERN).optional(),
  selector: z.string().min(1).max(500).optional(),
  /** 可见文本子串（大小写敏感）：取文档序首个「自身直接包含该文本」的可见元素。 */
  text: z.string().min(1).max(200).optional(),
} as const

export function locatorParamsError(p: {ref?: unknown; selector?: unknown; text?: unknown}): string | undefined {
  const count = [p.ref, p.selector, p.text].filter((v) => v !== undefined).length
  return count === 1 ? undefined : `pass exactly one of ref / selector / text (got ${count})`
}

function withLocatorRefine<S extends z.ZodRawShape>(shape: S) {
  return z.object(shape).superRefine((p, ctx) => {
    const message = locatorParamsError(p as {ref?: unknown; selector?: unknown; text?: unknown})
    if (message !== undefined) ctx.addIssue({code: 'custom', message})
  })
}

/** 定位滚动：把元素滚进视野。 */
export const scrollToParamsShape = {...locatorFields, ...tabIdField}

export const scrollToParams = withLocatorRefine(scrollToParamsShape)

const rectSchema = z.object({x: z.number(), y: z.number(), width: z.number(), height: z.number()})

/** probe：元素存在性 / 可见性 / rect / 文本 / 白名单属性（替代一串 evaluate_script 探查）。 */
export const probeParamsShape = {...locatorFields, ...tabIdField}

export const probeParams = withLocatorRefine(probeParamsShape)

export const probeResult = z.object({
  exists: z.boolean(),
  /** selector 模式下的匹配总数（只描述第一个）。 */
  count: z.number().int().min(0).optional(),
  /** 有尺寸、非 display:none / visibility:hidden / opacity:0。 */
  visible: z.boolean().optional(),
  inViewport: z.boolean().optional(),
  rect: rectSchema.optional(),
  tag: z.string().optional(),
  text: z.string().optional(),
  /** 白名单属性：id、class、role、name、type、href、placeholder、title、alt、disabled、aria-前缀、data-testid。 */
  attrs: z.record(z.string(), z.string()).optional(),
})

export const GET_HTML_DEFAULT_CHARS = 4_000
export const GET_HTML_MAX_CHARS = 20_000

export const getHtmlParamsShape = {
  ...locatorFields,
  /** outerHTML 字符上限（默认 4000，最大 20000）。 */
  maxChars: z.number().int().positive().max(GET_HTML_MAX_CHARS).optional(),
  ...tabIdField,
}

export const getHtmlParams = withLocatorRefine(getHtmlParamsShape)

export const getHtmlResult = z.object({
  html: z.string(),
  /** outerHTML 原始总长度（字符）。 */
  length: z.number().int().min(0),
  truncated: z.boolean(),
})

/** wait_for_response：等匹配的请求完成（只看元数据，不读响应体）。 */
export const waitForResponseParams = z.object({
  urlContains: z.string().min(1).max(500),
  /** 只认该状态码；缺省时任意完成（含失败）都算命中。 */
  status: z.number().int().min(100).max(599).optional(),
  method: z.string().min(1).max(16).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  /** 回看窗口：调用前 N ms 内已完成的匹配也算（覆盖「先点击、后 wait」的竞态）。默认 2000，0 = 只等未来。 */
  lookbackMs: z.number().int().min(0).max(30_000).optional(),
  ...tabIdField,
})

export const scrollToResult = z.object({
  /** 滚动后的元素视口 rect（CSS px）。 */
  rect: rectSchema,
  /** 元素中心是否落在视口内（false = 被 sticky 头/容器裁剪等，需进一步处理）。 */
  inViewport: z.boolean(),
  tag: z.string().optional(),
  text: z.string().optional(),
})

export const reloadParams = z.object({
  /** true = 绕过 HTTP 缓存（验证部署是否生效）。 */
  hard: z.boolean().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  ...tabIdField,
})

export const reloadResult = z.object({
  url: z.string(),
  title: z.string().optional(),
  loaded: z.boolean(),
  hard: z.boolean(),
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

/** click_at 落点处的元素（点击前 hit-test）；hit 为 null = 坐标处无元素。 */
export const hitInfoSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  role: z.string().optional(),
  text: z.string(),
  rect: z.object({x: z.number(), y: z.number(), width: z.number(), height: z.number()}),
  interactive: z.object({tag: z.string(), role: z.string().optional(), text: z.string()}).optional(),
  inIframe: z.boolean().optional(),
})

export const clickAtResult = z.object({
  hit: hitInfoSchema.nullable().optional(),
  /** space='image' 时实际点击的视口 CSS 坐标。 */
  css: z.object({x: z.number(), y: z.number()}).optional(),
})

/**
 * snapshot 未请求时两字段均缺省；点击已生效但取快照失败时只带 snapshotError。
 * dialogStillOpen：点击前后都有打开的对话框（点击只派发一次，不自动重试）。
 */
export const clickResult = z.object({
  dialogStillOpen: z.boolean().optional(),
  snapshot: snapshotResult.optional(),
  snapshotError: z.string().optional(),
})

export const screenshotResult = z.object({
  data: z.string(), // base64 PNG
  mimeType: z.literal('image/png'),
  /** 视口 CSS 尺寸与设备像素比；旧扩展不回传。 */
  width: z.number().optional(),
  height: z.number().optional(),
  dpr: z.number().optional(),
  /** 图片像素 / 设备像素的缩放比（旧字段，保留兼容）。 */
  scale: z.number().optional(),
  /** 回传图片的实际像素尺寸。 */
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  /** 图片像素 / CSS 像素：1 = 图片坐标即 CSS 坐标；< 1 = 图片被缩小过。 */
  cssScale: z.number().positive().optional(),
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

export const reloadExtensionParams = z.object({})

export const reloadExtensionResult = z.object({
  reloading: z.literal(true),
  version: z.string(),
})

/** ping 结果：startedAt 用于确认 reload_extension 后 SW 确实是新的一代。 */
export const pingResult = z.object({
  version: z.string(),
  userAgent: z.string(),
  startedAt: z.number().optional(),
})

/**
 * select_option：按可见文本选下拉项。ref 指向触发器（原生 <select>，或自定义下拉的选择框）。
 * search=true 时点开后先把 text 输入搜索框过滤（虚拟列表里未渲染的项靠它找到）。
 */
export const selectOptionParams = z.object({
  ref: z.string().regex(REF_PATTERN),
  text: z.string().min(1).max(200),
  search: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(10_000).optional(),
  ...tabIdField,
})

export const selectOptionResult = z.object({
  /** native = 原生 <select>；custom = 自定义下拉（点击了选项）。 */
  kind: z.enum(['native', 'custom']),
  /** 实际选中的选项文本。 */
  selected: z.string(),
  /** 选完后触发器显示的值（自定义下拉重渲染时可能读不回）。 */
  value: z.string().optional(),
})

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
  'ensure_tab',
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
  'run_actions',
  'scroll_to',
  'reload',
  'reload_extension',
  'probe',
  'get_html',
  'wait_for_response',
  'select_option',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * `run_actions` 允许的步骤工具：排除自身（防无界递归）、`screenshot`
 * （二进制结果不适合塞进批量文本，应单独调用）与 `reload_extension`（重载会杀掉正在执行的批量）。
 * 两端共用，避免漂移。
 */
export const ACTION_STEP_TOOLS = TOOL_NAMES.filter(
  (name) => name !== 'run_actions' && name !== 'screenshot' && name !== 'reload_extension',
)

export const actionStepSchema = z.object({
  tool: z.enum(ACTION_STEP_TOOLS as unknown as [ToolName, ...ToolName[]]),
  params: z.record(z.string(), z.unknown()).optional(),
})

/**
 * 批量执行：一次 MCP 调用按顺序跑多个工具，减少往返（如连续 press_key）。
 * 步骤逐个执行，后续步骤能看到前序造成的页面变化。
 */
export const runActionsParams = z.object({
  ...tabIdField,
  /** 有序步骤，最多 50 步。 */
  actions: z.array(actionStepSchema).min(1).max(50),
  /** true 时单步失败继续；默认在首个失败处停止。 */
  continueOnError: z.boolean().optional(),
})

export const runActionsResult = z.object({
  steps: z.array(
    z.object({
      index: z.number().int().min(0),
      tool: z.string(),
      ok: z.boolean(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
})
