import {defineConfig} from 'wxt'

export default defineConfig({
  manifest: {
    name: 'Claude in Chrome MCP',
    description:
      'Bridges a real Chrome profile to a local MCP server over WebSocket, so Claude Code can drive the browser.',
    version: '0.1.0',
    permissions: [
      'tabs',
      'scripting',
      'debugger',
      'webRequest',
      'webNavigation',
      'storage',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
  },
})
