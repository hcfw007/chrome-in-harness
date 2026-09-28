/** SW 入口：WS 重连、keepalive、CDP/ref 生命周期事件。监听一律顶层同步注册。 */
import {initCdpListeners} from '../lib/cdp'
import {connect} from '../lib/connection'
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
  })

  // 页面 URL 变化（硬导航与 pushState）→ 该 tab 的 ref 全部失效
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url !== undefined) refStore.invalidate(tabId)
  })

  // tab 关闭 → 释放其快照
  chrome.tabs.onRemoved.addListener((tabId) => {
    refStore.invalidate(tabId)
  })

  // 首次安装直接打开 options 页，引导配置白名单（空名单 = 拒绝全部）
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.runtime.openOptionsPage()
  })

  console.log('[background] Claude in Chrome MCP service worker started')
})
