/** options 页胶水：回填当前名单，保存走归一校验。 */
import {getAllowlist, saveAllowlistText} from '../../lib/whitelist'

const textarea = document.querySelector<HTMLTextAreaElement>('#domains')
const button = document.querySelector<HTMLButtonElement>('#save')
const status = document.querySelector<HTMLDivElement>('#status')

function showStatus(text: string, ok: boolean): void {
  if (status === null) return
  status.textContent = text
  status.className = ok ? 'ok' : 'err'
}

async function load(): Promise<void> {
  if (textarea === null) return
  const rules = await getAllowlist()
  textarea.value = rules.join('\n')
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

void load()
button?.addEventListener('click', () => void save())
