import {defineConfig} from 'wxt'

export default defineConfig({
  manifest: {
    name: 'Claude in Chrome MCP',
    description:
      'Bridges a real Chrome profile to a local MCP server over WebSocket, so Claude Code can drive the browser.',
    version: '0.1.0',
    // 按需申请：tabs（tab 管理 + onUpdated url 失效 ref）、storage（白名单）、
    // alarms（SW keepalive）、debugger（CDP 会话；黄条在 attach 时出现，声明本身无感）。
    permissions: ['alarms', 'tabs', 'storage', 'debugger', 'tabGroups'],
    // 仅放行本地 server。ws:// 不是合法的 match pattern scheme，用同源的 http:// 覆盖握手。
    host_permissions: ['http://127.0.0.1:8765/*'],
  },
})
