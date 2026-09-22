import {defineConfig} from 'wxt'

export default defineConfig({
  manifest: {
    name: 'Claude in Chrome MCP',
    description:
      'Bridges a real Chrome profile to a local MCP server over WebSocket, so Claude Code can drive the browser.',
    version: '0.1.0',
    // 只申请当前真正用到的权限。Phase 2 需要 tabs/scripting（或 debugger）时再按需追加，
    // 避免过早触发 Chrome 的调试黄条与商店审核风险。
    permissions: ['alarms'],
    // 仅放行本地 server。ws:// 不是合法的 match pattern scheme，用同源的 http:// 覆盖握手。
    host_permissions: ['http://127.0.0.1:8765/*'],
  },
})
