/**
 * a11y 树 → 带 ref 的缩进文本快照（纯函数）。
 * 行格式: `<indent>- <role> "<name>"[ [attr]...][ [ref=eN]][: "<value>"]`
 * 防膨胀: ignored 剪枝、无名 generic 压缩/幽灵化、深度/字符/ref 上限。
 */

import type {AxNode} from './ax-types'

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

export interface RefSeed {
  readonly ref: string
  readonly backendDOMNodeId: number
  readonly role: string
  readonly name: string
  readonly frameId: string | undefined
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
}

interface RenderState {
  lines: string[]
  refs: RefSeed[]
  nextRef: number
  visitedNodes: number
  charCount: number
  maxChars: number
  maxRefs: number
  maxTextLen: number
  truncated: boolean
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

/**
 * 无名 generic/none：单子或无子时压缩掉（不产行不占 ref）。
 * 例外：本身是 ref 候选（clickable）时绝不压缩——否则像「...」这类
 * icon-only 操作按钮会从快照里消失，模型只剩旁边同名/无名节点可点，必然点错。
 */
function isCollapsible(node: AxNode): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    node.name.length === 0 &&
    node.value.length === 0 &&
    node.childIds.length <= 1
  )
}

/** 无名 generic/none 但有多个子节点：本行不渲染，子级在 depth+1 正常渲染。同样跳过 ref 候选。 */
function isGhostContainer(node: AxNode): boolean {
  return (
    CONTAINER_ROLES.has(node.role) &&
    !isRefCandidate(node) &&
    node.name.length === 0 &&
    node.value.length === 0
  )
}

function renderLine(node: AxNode, depth: number, state: RenderState): void {
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
  if (isRefCandidate(node) && node.backendDOMNodeId !== undefined && state.nextRef <= state.maxRefs) {
    const ref = `e${state.nextRef}`
    state.nextRef += 1
    state.refs.push({
      ref,
      backendDOMNodeId: node.backendDOMNodeId,
      role: node.role,
      name: node.name,
      frameId: node.frameId,
    })
    parts.push(` [ref=${ref}]`)
  }
  if (VALUE_ROLES.has(node.role) && node.value.length > 0) {
    parts.push(`: "${clip(node.value, state.maxTextLen)}"`)
  }
  const line = `${indent}${parts.join('')}`
  state.lines.push(line)
  state.charCount += line.length + 1
}

export function renderAxSnapshot(nodes: readonly AxNode[], options: RenderOptions = {}): SnapshotRender {
  const byId = new Map<string, AxNode>()
  for (const node of nodes) byId.set(node.nodeId, node)

  const state: RenderState = {
    lines: [],
    refs: [],
    nextRef: 1,
    visitedNodes: 0,
    charCount: 0,
    maxChars: options.maxChars ?? MAX_CHARS,
    maxRefs: options.maxRefs ?? MAX_REFS,
    maxTextLen: options.maxTextLen ?? MAX_TEXT_LEN,
    truncated: false,
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
    if (isCollapsible(node)) {
      for (const childId of node.childIds) {
        const child = byId.get(childId)
        if (child !== undefined) dfs(child, depth)
      }
      return
    }
    if (isGhostContainer(node)) {
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
    renderLine(node, depth, state)
    state.visitedNodes += 1
    for (const childId of node.childIds) {
      const child = byId.get(childId)
      if (child !== undefined) dfs(child, depth + 1)
    }
  }

  const root = nodes[0]
  if (root !== undefined) dfs(root, 0)

  let text = state.lines.join('\n')
  if (state.truncated) {
    text += `\n… [truncated at ${state.visitedNodes} nodes / ${state.refs.length} refs]`
  }
  return {text, refs: state.refs, truncated: state.truncated}
}
