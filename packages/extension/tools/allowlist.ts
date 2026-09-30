/** add_allowlist_domain：运行时白名单授权。对话即授权界面——仅应在用户明确要求时调用。 */
import {normalizeHostRule} from '../lib/site-filter'
import {getAllowlist, setAllowlist} from '../lib/whitelist'

import type {ToolHandler} from './types'

export const addAllowlistDomain: ToolHandler = async (rawParams) => {
  const {domain} = rawParams as {domain: string}
  const parsed = normalizeHostRule(domain)
  if (!parsed.ok) throw new Error(`invalid domain: ${parsed.error}`)
  const current = await getAllowlist()
  if (!current.includes(parsed.rule)) {
    await setAllowlist([...current, parsed.rule])
  }
  return {domains: await getAllowlist()}
}
