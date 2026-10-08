/**
 * 新域名运行时确认：访问未在白名单内的域名时，弹出的确认窗口取代「静默拒绝」。
 *
 * 流程（非阻塞）：
 *  1. 工具调用命中未授权域名 → 写 pendingConfirmation 到 storage → 开/聚焦确认窗口
 *  2. 立即抛 DOMAIN_CONFIRMATION_REQUIRED，让模型提示用户确认后重试（避开 WS 30s 超时）
 *  3. 用户在窗口点「允许」→ 写入白名单并清 pending；「拒绝」→ 仅清 pending
 *
 * pending 通过 chrome.storage.local 传递（SW 与确认页是不同上下文），
 * 确认页监听 storage.onChanged，复用同一窗口展示最新请求。
 */

import {setAllowlist, getAllowlist} from './whitelist.js'

export const CONFIRMATION_STORAGE_KEY = 'domainConfirmation.v1'
export const CONFIRMATION_PAGE = 'confirm.html'

export interface PendingConfirmation {
  readonly version: 1
  /** 待确认主机名（bare host，小写）。 */
  readonly host: string
  /** 触发确认的 URL（展示用，让用户看清来源页面）。 */
  readonly url: string
  readonly createdAt: number
}

/** 读取当前待确认请求；无 / 损坏返回 undefined。 */
export async function readPendingConfirmation(): Promise<PendingConfirmation | undefined> {
  const bag = await chrome.storage.local.get(CONFIRMATION_STORAGE_KEY)
  const raw: unknown = bag[CONFIRMATION_STORAGE_KEY]
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Partial<PendingConfirmation>
  if (
    candidate.version !== 1 ||
    typeof candidate.host !== 'string' ||
    typeof candidate.url !== 'string'
  ) {
    return undefined
  }
  return {
    version: 1,
    host: candidate.host,
    url: candidate.url,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
  }
}

async function writePending(pending: PendingConfirmation | undefined): Promise<void> {
  if (pending === undefined) {
    await chrome.storage.local.remove(CONFIRMATION_STORAGE_KEY)
    return
  }
  await chrome.storage.local.set({[CONFIRMATION_STORAGE_KEY]: pending})
}

/** 找到已打开的确认窗口（复用而非重复弹窗）。 */
async function findConfirmationWindowId(): Promise<number | undefined> {
  const pageUrl = chrome.runtime.getURL(CONFIRMATION_PAGE)
  const windows = await chrome.windows.getAll({populate: true})
  for (const win of windows) {
    if (win.id === undefined) continue
    if ((win.tabs ?? []).some((tab) => tab.url === pageUrl)) return win.id
  }
  return undefined
}

/**
 * 请求确认某域名：写 pending + 开/聚焦确认窗口。
 * 同一域名重复请求只聚焦既有窗口，不重复弹窗。
 */
export async function requestDomainConfirmation(host: string, url: string): Promise<void> {
  await writePending({version: 1, host, url, createdAt: Date.now()})
  const existing = await findConfirmationWindowId()
  if (existing !== undefined) {
    await chrome.windows.update(existing, {focused: true})
    return
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL(CONFIRMATION_PAGE),
    type: 'popup',
    width: 420,
    height: 260,
  })
}

/** 用户在确认窗口点了「允许」：写入白名单（幂等）并清 pending。 */
export async function grantCurrentConfirmation(): Promise<void> {
  const pending = await readPendingConfirmation()
  if (pending !== undefined) {
    const current = await getAllowlist()
    if (!current.includes(pending.host)) {
      await setAllowlist([...current, pending.host])
    }
  }
  await writePending(undefined)
}

/** 用户在确认窗口点了「拒绝」：仅清 pending，不写白名单。 */
export async function denyCurrentConfirmation(): Promise<void> {
  await writePending(undefined)
}
