# claude-in-chrome-mcp

Claude-in-Chrome 风格的开源浏览器 MCP：通过 Chrome 扩展接管你**真实的 Chrome profile**（已登录态、cookie、插件环境都在），让 Claude Code 能直接驱动浏览器。非 sandbox 浏览器，非 headless 脚本方案。

## 架构

```
Chrome 扩展 (MV3, WXT)  --WebSocket client-->  本地 server (Node, ws on 127.0.0.1:8765)
                                                    |-- Streamable HTTP MCP --> Claude Code
```

三个包：`@cic/protocol`（两端共用的 WS 协议定义与类型守卫）、`@cic/server`、`@cic/extension`。

- 扩展 service worker 作为 WS **client** 主动连 `ws://127.0.0.1:8765`（无需 Chrome 额外暴露端口，连接由扩展发起）
- server 在 `http://127.0.0.1:12306/mcp` 暴露 MCP（Streamable HTTP，无状态模式）；收到 tool call 后通过 WS 转发给扩展，按消息 `id` 关联等待响应，超时 30s
- WS 协议 v1：请求 `{ v: 1, id, tool, params }`，响应 `{ v: 1, id, ok, result | error }`；定义与守卫集中在 `@cic/protocol`，server 与扩展共用一份

## 安全边界

- **WS 握手校验 Origin**：只接受 `chrome-extension://` 来源。浏览器强制写入 Origin 且页面无法伪造，因此恶意网页无法连上 `127.0.0.1:8765` 顶掉真扩展并接管 tool call。设 `CIC_EXTENSION_ID` 可进一步锁定到具体扩展 ID
- **MCP 端点开启 DNS rebinding 防护**：强制校验 Host 为 `127.0.0.1:12306` / `localhost:12306`；Origin 存在时一并校验（浏览器页面会被拒，Claude Code 这类不带 Origin 的客户端正常放行）
- **已知不覆盖**：本机任意进程可伪造 Origin 连上 WS。该类攻击者通常已能直接读 Chrome profile，不在本层威胁模型内
- 扩展权限按需申请，当前只有 `alarms` + loopback host permission；Phase 2 需要 `tabs`/`scripting`（或 `debugger`）时再追加

## Phase 1 当前进度

- [x] WS 桥（扩展 ↔ server）：断线指数退避重连（1s→10s）、keepalive alarm、请求按 id 关联 + 30s 超时
- [x] MCP HTTP 端点（Streamable HTTP，stateless）
- [x] 工具：`ping`（返回扩展版本 + userAgent，验证全链路连通）
- [x] WS Origin 鉴权 + MCP DNS rebinding 防护
- [x] 协议单一来源（`@cic/protocol`）、单测（vitest，三包）、ESLint（`@ddyscn/lint-config`）
- [x] Phase 2：a11y 快照 + ref 交互 + 域名白名单（见下）
- [ ] Phase 3：受限 `evaluateScript`

## Phase 2：快照 + ref 交互 + 白名单

**工具集**（12 个）：`ping`、`navigate`、`snapshot`、`click`、`hover`、`type`、`scroll`、`screenshot`、`tab_list`、`tab_new`、`tab_select`、`tab_close`。

- **snapshot**：`chrome.debugger` + CDP `Accessibility.getFullAXTree`，渲染成 Playwright ariaSnapshot 风格的缩进文本，交互元素带 `[ref=eN]`；click/hover/type/scroll 只接受 ref，杜绝选择器漂移
- **ref 生命周期**：ref 绑定 tab 的最近一次快照；导航/关 tab/debugger 分离即失效；SPA 重渲染导致的节点失效在 CDP 层映射为 `STALE_REF`；SW 被杀后报 `NO_SNAPSHOT` 引导重新 snapshot
- **真实输入**：点击/输入走 CDP `Input.*`（isTrusted=true），与真人操作无法区分
- **域名白名单**：`chrome.storage.local` 持久化，扩展侧在 attach 前校验，空名单 = 拒绝全部；规则 `example.com` 匹配自身与任意深度子域；首次安装自动打开 options 页
- **代价（已接受）**：attach 期间 Chrome 显示「正在调试」黄条；目标 tab 打开 DevTools 会顶掉扩展会话，工具报 `DEBUGGER_BUSY`，关闭 DevTools 后自动恢复

## 开发步骤

```bash
# 1. 构建（protocol → server → extension，顺序有依赖）
npm install
npm run build          # 扩展产物在 packages/extension/.output/chrome-mv3
npm test               # protocol 守卫 + server 桥接单测
npm run lint           # @ddyscn/lint-config（ESLint 9 flat config）
npm run lint:fix

# 2. 起本地 server
npm run dev:server

# 3. Chrome 加载扩展：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#    选择 packages/extension/.output/chrome-mv3

# 4. 注册 MCP 到 Claude Code
claude mcp add -s user claude-in-chrome --transport http http://127.0.0.1:12306/mcp
```

然后在 Claude Code 里让模型调 `ping`，应返回扩展版本与 userAgent。

## Roadmap

- **Phase 3** — 受限 `evaluateScript`（MV3 `chrome.scripting` + `world: "MAIN"`，注意页面 CSP 与注入面）
