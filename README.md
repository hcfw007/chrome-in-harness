# claude-in-chrome-mcp

Claude-in-Chrome 风格的开源浏览器 MCP：通过 Chrome 扩展接管你**真实的 Chrome profile**（已登录态、cookie、插件环境都在），让 Claude Code 能直接驱动浏览器。非 sandbox 浏览器，非 headless 脚本方案。

## 架构

```
Chrome 扩展 (MV3, WXT)  --WebSocket client-->  本地 server (Node, ws on 127.0.0.1:8765)
                                                    |-- Streamable HTTP MCP --> Claude Code
```

- 扩展 service worker 作为 WS **client** 主动连 `ws://127.0.0.1:8765`（无需 Chrome 额外暴露端口，连接由扩展发起）
- server 在 `http://127.0.0.1:12306/mcp` 暴露 MCP（Streamable HTTP，无状态模式）；收到 tool call 后通过 WS 转发给扩展，按消息 `id` 关联等待响应，超时 30s
- WS 协议 v1：请求 `{ v: 1, id, tool, params }`，响应 `{ v: 1, id, ok, result | error }`

## Phase 1 当前进度

- [x] WS 桥（扩展 ↔ server）：断线指数退避重连（1s→10s）、keepalive alarm、请求按 id 关联 + 30s 超时
- [x] MCP HTTP 端点（Streamable HTTP，stateless）
- [x] 工具：`ping`（返回扩展版本 + userAgent，验证全链路连通）
- [ ] Phase 2：a11y 快照 + ref 交互（click / type / snapshot，类似 Claude-in-Chrome 的 ref 机制）
- [ ] Phase 3：域名白名单 + `evaluateScript`

## 开发步骤

```bash
# 1. 构建扩展
npm install
npm run build          # 扩展产物在 packages/extension/.output/chrome-mv3

# 2. 起本地 server
npm run dev:server

# 3. Chrome 加载扩展：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#    选择 packages/extension/.output/chrome-mv3

# 4. 注册 MCP 到 Claude Code
claude mcp add -s user claude-in-chrome --transport http http://127.0.0.1:12306/mcp
```

然后在 Claude Code 里让模型调 `ping`，应返回扩展版本与 userAgent。

## Roadmap

- **Phase 2** — a11y 快照 + ref 交互：把页面 accessibility tree 转成带 `ref` 编号的快照，交互工具只接受 ref（click/type/scroll/hover），杜绝 CSS 选择器漂移
- **Phase 3** — 域名白名单（默认仅 user 配置的域可操作）+ 受限 `evaluateScript`
