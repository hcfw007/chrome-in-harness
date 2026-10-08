/**
 * 域名确认窗口胶水：展示待确认域名，允许 / 拒绝后清 pending 并关窗。
 * 监听 storage.onChanged 以支持「窗口已开着时又来一个新域名请求」的复用场景。
 */
import {
  CONFIRMATION_STORAGE_KEY,
  denyCurrentConfirmation,
  grantCurrentConfirmation,
  readPendingConfirmation,
} from '../../lib/domain-confirmation'

const panel = document.querySelector<HTMLDivElement>('#panel')
const empty = document.querySelector<HTMLDivElement>('#empty')
const hostEl = document.querySelector<HTMLDivElement>('#host')
const fromEl = document.querySelector<HTMLDivElement>('#from')
const allowBtn = document.querySelector<HTMLButtonElement>('#allow')
const denyBtn = document.querySelector<HTMLButtonElement>('#deny')

/** 关掉当前窗口（用户已处理）；窗口不在时无操作。 */
function closeWindow(): void {
  const win = window as unknown as {close?: () => void}
  win.close?.()
}

async function render(): Promise<void> {
  const pending = await readPendingConfirmation()
  if (pending === undefined) {
    if (panel !== null) panel.hidden = true
    if (empty !== null) empty.hidden = false
    return
  }
  if (panel !== null) panel.hidden = false
  if (empty !== null) empty.hidden = true
  if (hostEl !== null) hostEl.textContent = pending.host
  if (fromEl !== null) fromEl.textContent = pending.url
}

allowBtn?.addEventListener('click', () => {
  void grantCurrentConfirmation().then(closeWindow)
})

denyBtn?.addEventListener('click', () => {
  void denyCurrentConfirmation().then(closeWindow)
})

// 窗口开着时又来新请求（复用同窗口）：storage 变化即重渲染
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && CONFIRMATION_STORAGE_KEY in changes) void render()
})

void render()
