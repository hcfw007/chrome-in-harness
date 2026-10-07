/**
 * a11y 树 → 带 ref 的缩进文本快照（纯函数）。
 * 行格式: `<indent>- <role> "<name>"[ [attr]...][ [ref=eN]][ [weak]][: "<value>"]`
 * 防膨胀: ignored 剪枝、无名 generic 压缩/幽灵化、深度/字符/ref 上限。
 * 截断策略: 第一遍超预算后用 essentials 模式重渲——纯文本子树整体跳过、
 * 文本截得更短，保证有 ref 的交互节点不因截断丢失。
 * 定向渲染: query 正则过滤（保留命中节点的祖先链）、rootBackendNodeId 子树模式。
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
  /** 大小写不敏感正则：role 或 name 命中的节点保留（连同祖先链）。 */
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

/** 弱交互：无强信号但可点（DOM 扫描命中 / focusable 的 div/li/span 映射角色）。 */
function isWeakCandidate(node: AxNode, weakCandidates: ReadonlyMap<number, WeakInfo> | undefined): boolean {
  if (isRefCandidate(node)) return false
  if (node.backendDOMNodeId !== undefined && weakCandidates?.has(node.backendDOMNodeId) === true) return true
  return node.focusable && WEAK_ELIGIBLE_ROLES.has(node.role)
}

/**
 * 无名 generic/none：单子或无子时压缩掉（不产行不占 ref）。
 * 例外：本身是 ref 候选（clickable/弱交互）时绝不压缩——否则像「...」这类
 * icon-only 操作按钮会从快照里消失，模型只剩旁边同名/无名节点可点，必然点错。
 */
function isCollapsible(node: AxNode, weakCandidates: ReadonlyMap<number, WeakInfo> | undefined): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    !isWeakCandidate(node, weakCandidates) &&
    node.name.length === 0 &&
    node.value.length === 0 &&
    node.childIds.length <= 1
  )
}

/** 无名 generic/none 但有多个子节点：本行不渲染，子级在 depth+1 正常渲染。同样跳过候选。 */
function isGhostContainer(node: AxNode, weakCandidates: ReadonlyMap<number, WeakInfo> | undefined): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    !isWeakCandidate(node, weakCandidates) &&
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
function buildSubtreeHasRef(
  byId: ReadonlyMap<string, AxNode>,
  weakCandidates: ReadonlyMap<number, WeakInfo> | undefined,
): ReadonlyMap<string, boolean> {
  const memo = new Map<string, boolean>()
  const has = (node: AxNode): boolean => {
    const cached = memo.get(node.nodeId)
    if (cached !== undefined) return cached
    let result = isRefCandidate(node) || isWeakCandidate(node, weakCandidates)
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
): RenderState {
  const weakCandidates = options.weakCandidates
  const subtreeHasRef = buildSubtreeHasRef(byId, weakCandidates)
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
    if (isCollapsible(node, weakCandidates)) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined) dfs(child, depth)
      }
      return
    }
    if (isGhostContainer(node, weakCandidates)) {
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
    const weak = isWeakCandidate(node, weakCandidates)
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

/** query 命中集（自身或任一后代 role/name 命中），带 memo 的后序遍历。 */
function buildQueryMatches(
  byId: ReadonlyMap<string, AxNode>,
  query: RegExp,
): ReadonlyMap<string, boolean> {
  const memo = new Map<string, boolean>()
  const matches = (node: AxNode): boolean => {
    const cached = memo.get(node.nodeId)
    if (cached !== undefined) return cached
    let self: boolean
    try {
      self = query.test(node.role) || (node.name.length > 0 && query.test(node.name))
    } catch {
      self = false
    }
    let result = self
    if (!result) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined && matches(child)) {
          result = true
          break
        }
      }
    }
    memo.set(node.nodeId, result)
    return result
  }
  for (const node of byId.values()) matches(node)
  return memo
}

/** 保留命中节点与其祖先链，裁掉其余分支；裁剪节点写入 filteredById（副本改写了 childIds）。 */
function filterTree(
  byId: ReadonlyMap<string, AxNode>,
  rootNode: AxNode,
  matches: ReadonlyMap<string, boolean>,
  filteredById: Map<string, AxNode>,
): AxNode | undefined {
  if (!matches.get(rootNode.nodeId)) return undefined
  const keep = (node: AxNode): AxNode => {
    const keptChildren: AxNode[] = []
    for (const childId of node.childIds) {
      const child = byId.get(childId)
      if (child === undefined || !matches.get(childId)) continue
      keptChildren.push(keep(child))
    }
    const kept = {...node, childIds: keptChildren.map((c) => c.nodeId)}
    filteredById.set(kept.nodeId, kept)
    return kept
  }
  return keep(rootNode)
}

export function renderAxSnapshot(nodes: readonly AxNode[], options: RenderOptions = {}): SnapshotRender {
  const byId = new Map<string, AxNode>()
  for (const node of nodes) byId.set(node.nodeId, node)

  let renderById: ReadonlyMap<string, AxNode> = byId
  let roots: AxNode[] = nodes.length > 0 ? [nodes[0] as AxNode] : []

  if (options.rootBackendNodeId !== undefined) {
    const root = nodes.find((n) => n.backendDOMNodeId === options.rootBackendNodeId)
    if (root === undefined) {
      throw new Error('rootRef not found in the current accessibility tree; call snapshot first')
    }
    roots = [root]
  }

  if (options.query !== undefined) {
    const matches = buildQueryMatches(byId, options.query)
    const filteredById = new Map<string, AxNode>()
    const filteredRoots: AxNode[] = []
    for (const root of roots) {
      const kept = filterTree(byId, root, matches, filteredById)
      if (kept !== undefined) filteredRoots.push(kept)
    }
    if (filteredRoots.length === 0) {
      return {text: '', refs: [], truncated: false}
    }
    // 渲染必须走裁剪后的节点表：裁剪副本改写了 childIds，原表会让过滤失效
    renderById = filteredById
    roots = filteredRoots
  }

  const first = runRenderPass(renderById, roots, options, false)
  if (!first.truncated) return finalize(first, undefined)
  const second = runRenderPass(renderById, roots, options, true)
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
