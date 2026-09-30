/**
 * chrome.debugger 会话管理：attach 复用、onDetach 清理、事件等待、命令发送。
 * 白名单检查不在这里 —— tools/access.ts 保证先于任何 attach。
 */

import {TOOL_ERROR_CODES} from '@cic/protocol'

/** 「扩展认为已 attach」的 tab 集合；SW 重启后用 getTargets 惰性重查。 */
const sessions = new Map<number, true>()
const eventWaiters = new Map<string, Array<(payload: unknown) => void>>()
const eventSubscribers = new Map<string, Array<(params: unknown) => void>>()

function eventKey(tabId: number, method: string): string {
  return `${tabId}:${method}`
}

function lastErrorMessage(): string {
  const err = chrome.runtime.lastError
  return err?.message ?? ''
}

export function initCdpListeners(onDetached: (tabId: number) => void): void {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === undefined) return
    sessions.delete(source.tabId)
    onDetached(source.tabId)
  })
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return
    const key = eventKey(source.tabId, method)
    // 持续订阅者（console/network 缓冲）先喂；一次性 waiter 后喂并清空
    for (const cb of eventSubscribers.get(key) ?? []) cb(params)
    const waiters = eventWaiters.get(key)
    if (waiters !== undefined && waiters.length > 0) {
      for (const wake of waiters.splice(0)) wake(params)
    }
  })
}

function attach(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({tabId}, '1.3', () => {
      const message = lastErrorMessage()
      if (message.length > 0) {
        reject(
          message.includes('Another debugger')
            ? toolBusyError()
            : new Error(`failed to attach debugger: ${message}`),
        )
        return
      }
      sessions.set(tabId, true)
      resolve()
    })
  })
}

function toolBusyError(): Error {
  return new Error(
    `${TOOL_ERROR_CODES.DEBUGGER_BUSY}: another debugger (probably DevTools) is attached to this tab; close it and retry`,
  )
}

/** ① 会话内复用 ② getTargets 惰性重查（SW 被杀时浏览器级 attach 仍在）③ 重新 attach。 */
export async function ensureAttached(tabId: number): Promise<void> {
  if (sessions.has(tabId)) return
  const targets = await chrome.debugger.getTargets()
  const attached = targets.some((t) => t.tabId === tabId && t.attached)
  if (attached) {
    // 可能是我们的历史会话，也可能是 DevTools 占用 —— 后者由 send 报错透出
    sessions.set(tabId, true)
    return
  }
  await attach(tabId)
}

function normalizeSendError(message: string): Error {
  if (message.includes('not attached') || message.includes('Cannot attach')) {
    return new Error('debugger session was lost; retry the tool call to re-attach')
  }
  return new Error(message)
}

/** 发送一条 CDP 命令；未 attach 自动补 attach（自愈）。 */
export async function send<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!sessions.has(tabId)) await ensureAttached(tabId)
  return new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand({tabId}, method, params ?? {}, (result?: object) => {
      const message = lastErrorMessage()
      if (message.length > 0) {
        if (message.includes('not attached')) sessions.delete(tabId)
        reject(normalizeSendError(message))
        return
      }
      resolve((result ?? {}) as T)
    })
  })
}

/** 等一条 CDP 事件；超时返回 null（导航等待的降级路径）。 */
export function waitForEvent(tabId: number, method: string, timeoutMs: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    const key = eventKey(tabId, method)
    const waiters = eventWaiters.get(key) ?? []
    const timer = setTimeout(() => {
      const current = eventWaiters.get(key) ?? []
      const index = current.indexOf(wake)
      if (index !== -1) current.splice(index, 1)
      resolve(null)
    }, timeoutMs)
    const wake = (payload: unknown): void => {
      clearTimeout(timer)
      resolve(payload)
    }
    waiters.push(wake)
    eventWaiters.set(key, waiters)
  })
}

/** 注册某个 tab 某条 CDP 事件的持续订阅（console/network 缓冲用）。 */
export function subscribeEvents(tabId: number, method: string, cb: (params: unknown) => void): void {
  const key = eventKey(tabId, method)
  const list = eventSubscribers.get(key) ?? []
  list.push(cb)
  eventSubscribers.set(key, list)
}

export async function detach(tabId: number): Promise<void> {
  sessions.delete(tabId)
  await new Promise<void>((resolve) => {
    chrome.debugger.detach({tabId}, () => resolve())
  })
}
