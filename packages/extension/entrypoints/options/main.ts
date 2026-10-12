/** options 页胶水：回填当前名单，保存走归一校验。 */
import {confirmAllDomainsAccess, getAllDomainsAllowed} from '../../lib/domain-access'
import {getAllowlist, saveAllowlistText} from '../../lib/whitelist'

const textarea = document.querySelector<HTMLTextAreaElement>('#domains')
const button = document.querySelector<HTMLButtonElement>('#save')
const status = document.querySelector<HTMLDivElement>('#status')
const allDomains = document.querySelector<HTMLInputElement>('#all-domains')
const modeStatus = document.querySelector<HTMLParagraphElement>('#mode-status')

function renderMode(enabled: boolean): void {
  if (allDomains !== null) allDomains.checked = enabled
  if (modeStatus !== null) modeStatus.textContent = enabled
    ? '当前：允许所有 HTTP/HTTPS 域名（高风险）。仍仅能操作受管标签组；下方白名单已保留但暂不限制访问。'
    : '当前：按白名单限制访问。未授权域名需要逐个确认。'
}

function showStatus(text: string, ok: boolean): void {
  if (status === null) return
  status.textContent = text
  status.className = ok ? 'ok' : 'err'
}

async function load(): Promise<void> {
  const [rules, enabled] = await Promise.all([getAllowlist(), getAllDomainsAllowed()])
  if (textarea !== null) textarea.value = rules.join('\n')
  renderMode(enabled)
  if (allDomains !== null) allDomains.disabled = false
}

async function changeMode(): Promise<void> {
  if (allDomains === null) return
  const enabled = allDomains.checked
  allDomains.disabled = true
  try {
    renderMode(await confirmAllDomainsAccess(enabled, (message) => window.confirm(message)))
    showStatus(allDomains.checked ? '已开启全域访问（高风险）' : '保持白名单模式', true)
  } catch (error) {
    renderMode(!enabled)
    showStatus(`访问模式保存失败：${error instanceof Error ? error.message : String(error)}`, false)
  } finally {
    allDomains.disabled = false
  }
}

async function save(): Promise<void> {
  if (textarea === null) return
  const result = await saveAllowlistText(textarea.value)
  if (result.ok) {
    showStatus(`已保存 ${result.count} 条`, true)
  } else {
    showStatus(`保存失败：\n${result.errors.join('\n')}`, false)
  }
}

void load().catch((error: unknown) => showStatus(`加载失败：${String(error)}`, false))
button?.addEventListener('click', () => {
  void save().catch((error: unknown) => showStatus(`保存失败：${String(error)}`, false))
})
allDomains?.addEventListener('change', () => void changeMode())
