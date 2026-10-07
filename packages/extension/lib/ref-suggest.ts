/**
 * STALE_REF 报错的「相近 ref 建议」（纯逻辑，零 chrome.* 依赖）。
 * 在最新快照的 ref 里找出与失效 ref 最相似的几个候选，帮模型免二次快照自纠。
 */

import type {RefEntry} from './ref-store'

export interface RefSuggestion {
  readonly ref: string
  readonly role: string
  readonly name: string
}

/** 名称相似度打分：包含关系 > 前缀 > 公共词块；小写比较。 */
export function nameSimilarity(a: string, b: string): number {
  const la = a.trim().toLowerCase()
  const lb = b.trim().toLowerCase()
  if (la.length === 0 || lb.length === 0) return 0
  if (la === lb) return 5
  if (la.includes(lb) || lb.includes(la)) return 4
  if (la.startsWith(lb) || lb.startsWith(la)) return 3
  // 公共词块（按空白/连字符切分）
  const wordsA = new Set(la.split(/[\s\-_/]+/).filter((w) => w.length > 2))
  const wordsB = lb.split(/[\s\-_/]+/).filter((w) => w.length > 2)
  const shared = wordsB.filter((w) => wordsA.has(w)).length
  if (shared > 0) return 1 + Math.min(shared, 2)
  return 0
}

/**
 * 从最新快照条目中选出最接近失效元素的候选：
 * role 相同 +2，name 相似度（0-5）加总，取前 limit 个（score>0）。
 */
export function suggestSimilarRefs(
  lost: {role: string; name: string},
  entries: readonly RefEntry[],
  limit = 3,
): readonly RefSuggestion[] {
  const scored = entries.map((entry) => {
    let score = nameSimilarity(lost.name, entry.name)
    if (entry.role === lost.role) score += 2
    return {entry, score}
  })
  scored.sort((a, b) => b.score - a.score)
  const out: RefSuggestion[] = []
  for (const {entry, score} of scored) {
    if (score <= 0 || out.length >= limit) break
    out.push({ref: entry.ref, role: entry.role, name: entry.name})
  }
  return out
}

export function formatSuggestions(suggestions: readonly RefSuggestion[]): string {
  if (suggestions.length === 0) return ''
  const lines = suggestions.map((s) => `${s.ref} '${s.name || s.role}' (${s.role})`)
  return ` Closest refs in the current snapshot: ${lines.join(', ')}.`
}
