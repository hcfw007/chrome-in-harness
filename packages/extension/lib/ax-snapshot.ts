/**
 * a11y 树 → 带 ref 的缩进文本快照（纯函数）。
 * 行格式: `<indent>- <role> "<name>"[ [attr]...][ [ref=eN]][ [weak]][: "<value>"]`
 * 防膨胀: ignored 剪枝、无名 generic 压缩/幽灵化、深度/字符/ref 上限。
 * 截断策略: 第一遍超预算后用 essentials 模式重渲——纯文本子树整体跳过、
 * 文本截得更短，保证有 ref 的交互节点不因截断丢失。
 * 定向渲染: query 命中列表——交互命中（含弱交互）在前连子树，纯文本命中只留一行。
 */

import type {AxNode} from './ax-types'
import type {WeakInfo} from './weak-interactive'

export const MAX_DEPTH = 40
export const MAX_CHARS = 60_000
export const MAX_TEXT_LEN = 200
export const MAX_REFS = 2000

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'textarea', 'combobox', 'listbox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'option', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem',
])
const ANCHOR_ROLES = new Set(['heading', 'img'])
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'slider'])
const CONTAINER_ROLES = new Set(['generic', 'none'])
/** 弱交互 ref 的兜底角色集：div/li/span 自定义控件在 AX 里的常见映射。 */
const WEAK_ELIGIBLE_ROLES = new Set(['generic', 'none', 'image', 'listitem'])
/** 弹出容器：子树内的带名文本节点按弱交互分配 ref（下拉项常只是 dialog 下的 StaticText）。 */
const POPUP_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox'])
/** 弹出层内可给弱 ref 的角色（StaticText 保持 CDP 原样大小写）。 */
const POPUP_TEXT_ROLES = new Set([...WEAK_ELIGIBLE_ROLES, 'StaticText'])
/** query 模式纯文本命中的输出上限（超出报数，绝不挤占交互命中预算）。 */
const MAX_QUERY_TEXT_HITS = 40

export interface RefSeed {
  readonly ref: string
  readonly backendDOMNodeId: number
  readonly role: string
  readonly name: string
  readonly frameId: string | undefined
  /** 弱交互节点（无 ARIA role 的可点击 div/li/span），标注供模型参考。 */
  readonly weak?: boolean
}

export interface SnapshotRender {
  readonly text: string
  readonly refs: readonly RefSeed[]
  readonly truncated: boolean
}

export interface RenderOptions {
  readonly maxDepth?: number
  readonly maxChars?: number
  readonly maxRefs?: number
  readonly maxTextLen?: number
  /** 大小写不敏感正则：query 定向渲染——交互命中在前（连子树），纯文本命中只留一行。 */
  readonly query?: RegExp
  /** 只渲染该 backendDOMNodeId 节点的子树；找不到抛错。 */
  readonly rootBackendNodeId?: number
  /** DOM 扫描得到的弱交互候选（backendDOMNodeId → 标签/文本）。 */
  readonly weakCandidates?: ReadonlyMap<number, WeakInfo>
}

interface RenderState {
  lines: string[]
  refs: RefSeed[]
  nextRef: number
  visitedNodes: number
  skippedTextNodes: number
  charCount: number
  maxChars: number
  maxRefs: number
  maxTextLen: number
  truncated: boolean
  /** essentials 模式：跳过无 ref 候选的纯文本子树，文本截得更短。 */
  essentials: boolean
}

function clip(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text
}

function isRefCandidate(node: AxNode): boolean {
  return (
    INTERACTIVE_ROLES.has(node.role) ||
    node.clickable ||
    // 无名但带 aria-haspopup 的 icon-only 控件（如「...」菜单按钮）
    node.hasPopup ||
    ANCHOR_ROLES.has(node.role)
  )
}

/** 弱交互判定上下文：DOM 扫描候选 + 弹出层归属表（nodeId → 在弹出容器子树内）。 */
interface WeakContext {
  readonly candidates: ReadonlyMap<number, WeakInfo> | undefined
  readonly popup: ReadonlyMap<string, boolean>
}

/** memo 化收集：nodeId → 自身是弹出容器或任一祖先是（只存 true，缺席即不在弹出层内）。 */
function buildPopupMap(byId: ReadonlyMap<string, AxNode>): ReadonlyMap<string, boolean> {
  const inside = new Map<string, boolean>()
  const queue: AxNode[] = []
  for (const node of byId.values()) {
    if (POPUP_ROLES.has(node.role)) {
      inside.set(node.nodeId, true)
      queue.push(node)
    }
  }
  while (queue.length > 0) {
    const popup = queue.pop()!
    for (const childId of popup.childIds) {
      const child = byId.get(childId)
      if (child === undefined || inside.get(child.nodeId) === true) continue
      inside.set(child.nodeId, true)
      queue.push(child)
    }
  }
  return inside
}

function buildWeakContext(
  byId: ReadonlyMap<string, AxNode>,
  candidates: ReadonlyMap<number, WeakInfo> | undefined,
): WeakContext {
  return {candidates, popup: buildPopupMap(byId)}
}

/** 弱交互：无强信号但可点（DOM 扫描命中 / 弹出层内带名文本 / focusable 的 div/li/span 映射角色）。 */
function isWeakCandidate(node: AxNode, ctx: WeakContext): boolean {
  if (isRefCandidate(node)) return false
  if (node.backendDOMNodeId !== undefined && ctx.candidates?.has(node.backendDOMNodeId) === true) return true
  if (
    ctx.popup.get(node.nodeId) === true &&
    node.name.length > 0 &&
    node.backendDOMNodeId !== undefined &&
    POPUP_TEXT_ROLES.has(node.role)
  ) {
    return true
  }
  return node.focusable && WEAK_ELIGIBLE_ROLES.has(node.role)
}

/**
 * 无名 generic/none：单子或无子时压缩掉（不产行不占 ref）。
 * 例外：本身是 ref 候选（clickable/弱交互）时绝不压缩——否则像「...」这类
 * icon-only 操作按钮会从快照里消失，模型只剩旁边同名/无名节点可点，必然点错。
 */
function isCollapsible(node: AxNode, ctx: WeakContext): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    !isWeakCandidate(node, ctx) &&
    node.name.length === 0 &&
    node.value.length === 0 &&
    node.childIds.length <= 1
  )
}

/** 无名 generic/none 但有多个子节点：本行不渲染，子级在 depth+1 正常渲染。同样跳过候选。 */
function isGhostContainer(node: AxNode, ctx: WeakContext): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    !isWeakCandidate(node, ctx) &&
    node.name.length === 0 &&
    node.value.length === 0
  )
}

function renderLine(node: AxNode, depth: number, state: RenderState, weak: boolean): void {
  const indent = '  '.repeat(depth)
  const parts: string[] = []
  parts.push(`- ${node.role}`)
  if (node.name.length > 0) parts.push(` "${clip(node.name, state.maxTextLen)}"`)
  if (node.level !== undefined) parts.push(` [level=${node.level}]`)
  if (node.checked === 'true') parts.push(' [checked]')
  if (node.checked === 'mixed') parts.push(' [mixed]')
  if (node.disabled) parts.push(' [disabled]')
  if (node.expanded !== undefined) parts.push(node.expanded ? ' [expanded]' : ' [collapsed]')
  if (node.selected === true) parts.push(' [selected]')
  if (
    (isRefCandidate(node) || weak) &&
    node.backendDOMNodeId !== undefined &&
    state.nextRef <= state.maxRefs
  ) {
    const ref = `e${state.nextRef}`
    state.nextRef += 1
    state.refs.push({
      ref,
      backendDOMNodeId: node.backendDOMNodeId,
      role: node.role,
      name: node.name,
      frameId: node.frameId,
      ...(weak ? {weak: true} : {}),
    })
    parts.push(` [ref=${ref}]`)
    if (weak) parts.push(' [weak]')
  }
  if (VALUE_ROLES.has(node.role) && node.value.length > 0) {
    parts.push(`: "${clip(node.value, state.maxTextLen)}"`)
  }
  const line = `${indent}${parts.join('')}`
  state.lines.push(line)
  state.charCount += line.length + 1
}

/** 该节点子树里是否藏着 ref 候选（含弱交互）；带 memo 的后序遍历。 */
function buildSubtreeHasRef(byId: ReadonlyMap<string, AxNode>, ctx: WeakContext): ReadonlyMap<string, boolean> {
  const memo = new Map<string, boolean>()
  const has = (node: AxNode): boolean => {
    const cached = memo.get(node.nodeId)
    if (cached !== undefined) return cached
    let result = isRefCandidate(node) || isWeakCandidate(node, ctx)
    if (!result) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined && has(child)) {
          result = true
          break
        }
      }
    }
    memo.set(node.nodeId, result)
    return result
  }
  for (const node of byId.values()) has(node)
  return memo
}

function runRenderPass(
  byId: ReadonlyMap<string, AxNode>,
  roots: readonly AxNode[],
  options: RenderOptions,
  essentials: boolean,
  ctx: WeakContext,
): RenderState {
  const subtreeHasRef = buildSubtreeHasRef(byId, ctx)
  const state: RenderState = {
    lines: [],
    refs: [],
    nextRef: 1,
    visitedNodes: 0,
    skippedTextNodes: 0,
    charCount: 0,
    maxChars: options.maxChars ?? MAX_CHARS,
    maxRefs: options.maxRefs ?? MAX_REFS,
    maxTextLen: essentials
      ? Math.max((options.maxTextLen ?? MAX_TEXT_LEN) >> 2, 24)
      : options.maxTextLen ?? MAX_TEXT_LEN,
    truncated: false,
    essentials,
  }

  const dfs = (node: AxNode, depth: number): void => {
    if (state.truncated) return
    if (node.ignored) {
      // ignored 节点不渲染自身，但语义子节点可能藏在下面 —— 子级提升到同深度继续遍历
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined) dfs(child, depth)
      }
      return
    }
    // essentials 模式：整个子树都没有 ref 候选 → 跳过，把字符预算让给交互节点
    if (essentials && !subtreeHasRef.get(node.nodeId)) {
      state.skippedTextNodes += 1
      return
    }
    if (isCollapsible(node, ctx)) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined) dfs(child, depth)
      }
      return
    }
    if (isGhostContainer(node, ctx)) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined) dfs(child, depth + 1)
      }
      return
    }
    if (depth > (options.maxDepth ?? MAX_DEPTH)) {
      state.lines.push(`${'  '.repeat(depth - 1)}- … [depth limit]`)
      return
    }
    if (state.charCount > state.maxChars) {
      state.truncated = true
      return
    }
    const weak = isWeakCandidate(node, ctx)
    renderLine(node, depth, state, weak)
    state.visitedNodes += 1
    for (const childId of node.childIds) {
      const child = byId.get(childId)
      if (child !== undefined) dfs(child, depth + 1)
    }
  }

  for (const root of roots) dfs(root, 0)
  return state
}

/** query 自命中节点（role/name 匹配），文档序；ignored 节点只透传、不收集。 */
function collectQueryHits(
  byId: ReadonlyMap<string, AxNode>,
  roots: readonly AxNode[],
  query: RegExp,
): AxNode[] {
  const hits: AxNode[] = []
  const visit = (node: AxNode): void => {
    if (!node.ignored) {
      let self: boolean
      try {
        self = query.test(node.role) || (node.name.length > 0 && query.test(node.name))
      } catch {
        self = false
      }
      if (self) hits.push(node)
    }
    for (const childId of node.childIds) {
      const child = byId.get(childId)
      if (child !== undefined) visit(child)
    }
  }
  for (const root of roots) visit(root)
  return hits
}

/** node 及其全部后代的 nodeId 集合（含自身），用于命中去重。 */
function collectDescendantIds(byId: ReadonlyMap<string, AxNode>, root: AxNode): ReadonlySet<string> {
  const ids = new Set<string>()
  const walk = (node: AxNode): void => {
    if (ids.has(node.nodeId)) return
    ids.add(node.nodeId)
    for (const childId of node.childIds) {
      const child = byId.get(childId)
      if (child !== undefined) walk(child)
    }
  }
  walk(root)
  return ids
}

/**
 * query 定向渲染：交互命中（含弱交互）在前、纯文本命中在后，组内按文档序。
 * 交互命中连子树整体渲染（嵌套 ref 不丢）；纯文本命中只保留自身一行，
 * 不再展开子树/兄弟（评论区长句淹没真按钮的教训）。祖先链不再保留——
 * 命中列表按预算直出，首行即最优先的命中。
 */
function renderQuerySnapshot(
  byId: ReadonlyMap<string, AxNode>,
  roots: readonly AxNode[],
  options: RenderOptions,
  ctx: WeakContext,
  query: RegExp,
): SnapshotRender {
  const hits = collectQueryHits(byId, roots, query)
  if (hits.length === 0) return {text: '', refs: [], truncated: false}

  const interactiveHits: AxNode[] = []
  const textHits: AxNode[] = []
  const covered = new Set<string>()
  for (const hit of hits) {
    if (covered.has(hit.nodeId)) continue
    if (isRefCandidate(hit) || isWeakCandidate(hit, ctx)) {
      interactiveHits.push(hit)
      for (const id of collectDescendantIds(byId, hit)) covered.add(id)
    } else {
      textHits.push(hit)
    }
  }

  const first = runRenderPass(byId, interactiveHits, options, false, ctx)
  let pass = first
  if (pass.truncated) pass = runRenderPass(byId, interactiveHits, options, true, ctx)
  const lines = [...pass.lines]
  const refs = [...pass.refs]
  let truncated = pass.truncated

  if (!pass.truncated && textHits.length > 0) {
    const maxChars = options.maxChars ?? MAX_CHARS
    const state: RenderState = {
      lines: [],
      refs: [],
      nextRef: pass.nextRef,
      visitedNodes: 0,
      skippedTextNodes: 0,
      charCount: pass.charCount,
      maxChars,
      maxRefs: pass.maxRefs,
      maxTextLen: pass.maxTextLen,
      truncated: false,
      essentials: false,
    }
    const overflow = Math.max(textHits.length - MAX_QUERY_TEXT_HITS, 0)
    for (const hit of textHits.slice(0, MAX_QUERY_TEXT_HITS)) {
      renderLine({...hit, childIds: []}, 0, state, false)
      if (state.charCount > maxChars) {
        state.truncated = true
        break
      }
    }
    lines.push(...state.lines)
    if (state.truncated) truncated = true
    if (overflow > 0) {
      lines.push(`… [+${overflow} more text matches hidden]`)
      truncated = true
    }
  }

  let text = lines.join('\n')
  if (truncated) text += `\n… [truncated at ${pass.visitedNodes} nodes / ${refs.length} refs]`
  return {text, refs, truncated}
}

export function renderAxSnapshot(nodes: readonly AxNode[], options: RenderOptions = {}): SnapshotRender {
  const byId = new Map<string, AxNode>()
  for (const node of nodes) byId.set(node.nodeId, node)

  const renderById: ReadonlyMap<string, AxNode> = byId
  let roots: AxNode[] = nodes.length > 0 ? [nodes[0] as AxNode] : []

  if (options.rootBackendNodeId !== undefined) {
    const root = nodes.find((n) => n.backendDOMNodeId === options.rootBackendNodeId)
    if (root === undefined) {
      throw new Error('rootRef not found in the current accessibility tree; call snapshot first')
    }
    roots = [root]
  }

  const ctx = buildWeakContext(byId, options.weakCandidates)

  if (options.query !== undefined) {
    return renderQuerySnapshot(byId, roots, options, ctx, options.query)
  }

  const first = runRenderPass(renderById, roots, options, false, ctx)
  if (!first.truncated) return finalize(first, undefined)
  const second = runRenderPass(renderById, roots, options, true, ctx)
  if (second.truncated) return finalize(second, `… [truncated at ${second.visitedNodes} nodes / ${second.refs.length} refs]`)
  // refs 全保住了，但纯文本子树被隐藏 —— 仍算 truncated（内容确实丢了）
  return finalize(second, `… [truncated at ${second.skippedTextNodes} text-only nodes to keep interactive refs]`)
}

function finalize(state: RenderState, footer: string | undefined): SnapshotRender {
  let text = state.lines.join('\n')
  if (footer !== undefined && footer.length > 0) {
    text += `\n${footer}`
  }
  return {text, refs: state.refs, truncated: footer !== undefined}
}

/**
 * 给渲染结果追加快照 token：`[ref=eN]` → `[ref=eN-<token>]`。
 * token 编码 worker 代 + 快照版本，跨代/跨版本的旧 ref 会被显式拒绝（防静默错点）。
 */
export function applyRefToken(render: SnapshotRender, token: string): SnapshotRender {
  return {
    text: render.text.replace(/\[ref=(e[1-9]\d*)\]/g, `[ref=$1-${token}]`),
    refs: render.refs.map((r) => ({...r, ref: `${r.ref}-${token}`})),
    truncated: render.truncated,
  }
}
