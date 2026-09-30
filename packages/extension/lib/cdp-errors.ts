/**
 * CDP 错误归类（纯逻辑，零 chrome.* 依赖）。
 *
 * stale 节点错误：快照拿到的 backendNodeId 已失效（元素被移除/替换、DOM 重渲染），
 * 此时应引导模型重新 snapshot，而不是把原始 CDP 报文直接抛给模型。
 */

/** CDP 在目标 backendNodeId 失效时可能返回的报文片段（大小写不敏感匹配）。 */
const STALE_NODE_MARKERS: readonly string[] = [
  // 节点已从 DOM 移除，但 CDP 仍持有旧 id
  'No node with given id',
  // 元素被移除或替换（SPA 重渲染常见）
  'Node is detached from document',
  'does not belong to the document',
]

/** 判断错误是否属于「ref 已失效」，供交互工具统一映射为 STALE_REF。 */
export function isStaleNodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return STALE_NODE_MARKERS.some((marker) => message.includes(marker))
}
