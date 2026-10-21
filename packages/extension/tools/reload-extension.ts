/**
 * reload_extension：开发态自重载（等同 chrome://extensions 上点 ↻，重新读取磁盘产物）。
 * 仅允许解压加载（installType === 'development'）；商店安装版本显式拒绝。
 * 先回包再重载：延迟一小段时间让 WS 响应发出去，否则 server 只会看到连接断开。
 */
import type {ToolHandler} from './types'

/** 回包与重载之间的间隔：足够 ws.send 冲刷出去。 */
export const RELOAD_DELAY_MS = 200

export const reloadExtension: ToolHandler = async () => {
  const self = await chrome.management.getSelf()
  if (self.installType !== 'development') {
    throw new Error(
      `reload_extension is only available for an unpacked (development) install; this one is "${self.installType}". ` +
        'Reload it from chrome://extensions instead.',
    )
  }
  setTimeout(() => chrome.runtime.reload(), RELOAD_DELAY_MS)
  return {reloading: true, version: chrome.runtime.getManifest().version}
}
