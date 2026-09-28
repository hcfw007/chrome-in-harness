/**
 * 白名单的 chrome.storage.local 持久化（薄封装）。
 * 存储 shape: { version: 1, domains: string[] }，key 见 ALLOWLIST_STORAGE_KEY。
 * 读取时缺失/损坏一律回退空名单并告警 —— 空名单 = 拒绝全部（安全默认）。
 */

import {normalizeDomainRules} from './site-filter.js'

export const ALLOWLIST_STORAGE_KEY = 'allowlist.v1'

interface StoredAllowlist {
  readonly version: 1
  readonly domains: readonly string[]
}

export async function getAllowlist(): Promise<readonly string[]> {
  const bag = await chrome.storage.local.get(ALLOWLIST_STORAGE_KEY)
  const raw: unknown = bag[ALLOWLIST_STORAGE_KEY]
  if (typeof raw !== 'object' || raw === null) return []
  const candidate = raw as Partial<StoredAllowlist>
  if (candidate.version !== 1 || !Array.isArray(candidate.domains)) {
    console.warn('[whitelist] malformed allowlist in storage; treating as empty')
    return []
  }
  return candidate.domains.filter((d): d is string => typeof d === 'string')
}

export async function setAllowlist(rules: readonly string[]): Promise<void> {
  const stored: StoredAllowlist = {version: 1, domains: [...rules]}
  await chrome.storage.local.set({[ALLOWLIST_STORAGE_KEY]: stored})
}

/** options 页保存入口：先归一校验，非法整体拒绝并返回逐条错误。 */
export async function saveAllowlistText(text: string): Promise<{ok: true; count: number} | {ok: false; errors: readonly string[]}> {
  const parsed = normalizeDomainRules(text)
  if (!parsed.ok) return {ok: false, errors: parsed.errors}
  await setAllowlist(parsed.rules)
  return {ok: true, count: parsed.rules.length}
}
