/** SW 入口：WS 重连、keepalive、CDP/ref 生命周期事件。监听一律顶层同步注册。 */
import {initCdpListeners} from '../lib/cdp'
import {dropCollectors} from '../lib/cdp-commands'
import {connect} from '../lib/connection'
import {consoleBuffer} from '../lib/console-buffer'
import {networkBuffer} from '../lib/network-buffer'
import {refStore} from '../lib/ref-store'

const KEEPALIVE_ALARM = 'keepalive'
const KEEPALIVE_PERIOD_MINUTES = 0.5

export default defineBackground(() => {
  connect()

  chrome.alarms.create(KEEPALIVE_ALARM, {periodInMinutes: KEEPALIVE_PERIOD_MINUTES})
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      connect()
    }
  })

  // 调试会话被强制分离（DevTools 接管 / 用户取消 / tab 关闭）：
  // cdp.ts 内部清 attach 状态；这里连带失效该 tab 的 ref
  initCdpListeners((tabId) => {
    refStore.invalidate(tabId)
    consoleBuffer.clear(tabId)
    networkBuffer.clear(tabId)
    dropCollectors(tabId)
  })

  // 页面 URL 变化（硬导航与 pushState）→ 该 tab 的 ref 全部失效
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url !== undefined) refStore.invalidate(tabId)
  })

  // tab 关闭 → 释放其快照
  chrome.tabs.onRemoved.addListener((tabId) => {
    refStore.invalidate(tabId)
    consoleBuffer.clear(tabId)
    networkBuffer.clear(tabId)
    dropCollectors(tabId)
  })

  console.log('[background] Chrome in Harness service worker started')
})
