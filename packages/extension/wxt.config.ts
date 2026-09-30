import {defineConfig} from 'wxt'

export default defineConfig({
  zip: {
    name: 'chrome-in-harness',
  },
  manifest: {
    name: 'Chrome in Harness',
    description:
      'Bridges a real Chrome profile to a local MCP server over WebSocket, so any MCP client can drive the browser.',
    // version 不显式声明，wxt 从 package.json 的 version 读取（单一真源）
    // 按需申请：tabs（tab 管理 + onUpdated url 失效 ref）、storage（白名单）、
    // alarms（SW keepalive）、debugger（CDP 会话；黄条在 attach 时出现，声明本身无感）。
    permissions: ['alarms', 'tabs', 'storage', 'debugger', 'tabGroups', 'permissions'],
    // 仅放行本地 server。ws:// 不是合法的 match pattern scheme，用同源的 http:// 覆盖握手。
    host_permissions: ['http://127.0.0.1:8765/*'],
    // 运行时弹窗授权（request_permission）需要 optional host 权限；白名单存储仍为主闸。
    optional_host_permissions: ['*://*/*'],
  },
})
