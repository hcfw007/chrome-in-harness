# chrome-in-harness

Claude-in-Chrome 风格的开源浏览器 MCP：通过 Chrome 扩展接管你**真实的 Chrome profile**（已登录态、cookie、插件环境都在），让任何 MCP 客户端（Claude Code / opencode 等）都能直接驱动浏览器。非 sandbox 浏览器，非 headless 脚本方案。

## 架构

```
Chrome 扩展 (MV3, WXT)  --WebSocket client-->  本地 server (Node, ws on 127.0.0.1:8765)
                                                    |-- Streamable HTTP MCP --> 任意 MCP 客户端
```

三个包：`@chrome-in-harness/protocol`（两端共用的 WS 协议定义与类型守卫）、`@chrome-in-harness/server`、`@chrome-in-harness/extension`。

- 扩展 service worker 作为 WS **client** 主动连 `ws://127.0.0.1:8765`（无需 Chrome 额外暴露端口，连接由扩展发起）
- server 在 `http://127.0.0.1:12306/mcp` 暴露 MCP（Streamable HTTP，无状态模式）；收到 tool call 后通过 WS 转发给扩展，按消息 `id` 关联等待响应，超时 30s
- WS 协议 v1：请求 `{ v: 1, id, tool, params }`，响应 `{ v: 1, id, ok, result | error }`；定义与守卫集中在 `@chrome-in-harness/protocol`，server 与扩展共用一份

## 安全边界

- **WS 握手校验 Origin**：只接受 `chrome-extension://` 来源。浏览器强制写入 Origin 且页面无法伪造，因此恶意网页无法连上 `127.0.0.1:8765` 顶掉真扩展并接管 tool call。设 `CIC_EXTENSION_ID` 可进一步锁定到具体扩展 ID
- **MCP 端点开启 DNS rebinding 防护**：强制校验 Host 为 `127.0.0.1:12306` / `localhost:12306`；Origin 存在时一并校验（浏览器页面会被拒，非浏览器 MCP 客户端正常放行）
- **已知不覆盖**：本机任意进程可伪造 Origin 连上 WS。该类攻击者通常已能直接读 Chrome profile，不在本层威胁模型内
- 扩展权限按需申请，当前只有 `alarms` + loopback host permission；Phase 2 需要 `tabs`/`scripting`（或 `debugger`）时再追加

## Phase 1 当前进度

- [x] WS 桥（扩展 ↔ server）：断线指数退避重连（1s→10s）、keepalive alarm、请求按 id 关联 + 30s 超时
- [x] MCP HTTP 端点（Streamable HTTP，stateless）
- [x] 工具：`ping`（返回扩展版本 + userAgent，验证全链路连通）
- [x] WS Origin 鉴权 + MCP DNS rebinding 防护
- [x] 协议单一来源（`@chrome-in-harness/protocol`）、单测（vitest，三包）、ESLint（`@ddyscn/lint-config`）
- [x] Phase 2：a11y 快照 + ref 交互 + 域名白名单（见下）
- [x] Phase 3a：`read_console` / `read_network` / `wait` / 运行时白名单授权 + CI（见下）
- [x] Phase 3b：受限 `evaluate_script`、权限弹窗授权 `request_permission`（见下）

## Phase 2：快照 + ref 交互 + 白名单

**工具集**（18 个）：`ping`、`navigate`、`snapshot`、`click`、`hover`、`type`、`scroll`、`screenshot`、`tab_list`、`tab_new`、`tab_select`、`tab_close`、`read_console`、`read_network`、`wait`、`add_allowlist_domain`、`evaluate_script`、`request_permission`。

- **read_console / read_network**：CDP 采集的 console 与网络请求元数据（响应体不采集）。缓冲从 tab 首次被工具 attach 起积累
- **wait**：等待文本 / CSS 选择器 / URL 子串出现（页面内 Promise 轮询，默认 8s 上限 30s），超时返回 `{matched:false}` 而非报错
- **add_allowlist_domain**：运行时扩白名单。仅在用户明确要求时调用——对话即授权界面
- **evaluate_script**：受限 `Runtime.evaluate` 执行页面上下文 JS。黑名单拒绝网络访问（fetch/XHR/WebSocket/sendBeacon）、eval/Function、导航（location/window.open）、document.write、debugger 与 `chrome.*`；`awaitPromise:true` 需 async IIFE；结果 JSON 序列化超限截断
- **request_permission**：针对域名发起 `chrome.permissions.request` 原生授权弹窗，授予后同步写入 storage 白名单。仅当用户明确要求时调用

- **snapshot**：`chrome.debugger` + CDP `Accessibility.getFullAXTree`，渲染成 Playwright ariaSnapshot 风格的缩进文本，交互元素带 `[ref=eN]`；click/hover/type/scroll 只接受 ref，杜绝选择器漂移
- **ref 生命周期**：ref 绑定 tab 的最近一次快照；导航/关 tab/debugger 分离即失效；SPA 重渲染导致的节点失效在 CDP 层映射为 `STALE_REF`；SW 被杀后报 `NO_SNAPSHOT` 引导重新 snapshot
- **真实输入**：点击/输入走 CDP `Input.*`（isTrusted=true），与真人操作无法区分
- **域名白名单**：`chrome.storage.local` 持久化，扩展侧在 attach 前校验，空名单 = 拒绝全部；规则 `example.com` 匹配自身与任意深度子域；首次安装自动打开 options 页
- **代价（已接受）**：attach 期间 Chrome 显示「正在调试」黄条；目标 tab 打开 DevTools 会顶掉扩展会话，工具报 `DEBUGGER_BUSY`，关闭 DevTools 后自动恢复
- **输入前提（自动处理）**：CDP `Input.*` 在后台 tab 与最小化窗口上会被静默丢弃；输入类工具派发前会激活目标 tab，窗口最小化时自动恢复并聚焦，恢复失败报 `WINDOW_NOT_INTERACTIVE`

## 安装与使用

两种方式：**npm 快速安装**（推荐）或 **GitHub Release / 源码**。

> **MCP 升级后必须重启客户端会话**：opencode / Claude Code 等客户端在会话启动时注册工具 schema，
> 运行中不会随服务端 `tools/list` 变化热更新（不监听 `tools/list_changed`）。服务端升级新参数/新工具后，
> 老会话仍按旧 schema 校验并拦截新参数——重启会话即可。ref 格式同样注意：快照 ref 带 token
> 后缀（如 `e3-a7k2`），跨会话/跨 worker 重启的旧 ref 会被显式拒绝（`STALE_REF`），重新 snapshot 即可。

### npm 快速安装

```bash
# 1. 启动本地 server 并自动写入 opencode / .mcp.json 配置
npx chrome-in-harness start

# 2. 装扩展：Chrome 打开 chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#    选择 GitHub Releases 下载的 chrome-in-harness-extension.zip 解压目录，
#    或本仓库 packages/extension/.output/chrome-mv3

# 3. 自检全链路
npx chrome-in-harness doctor
```

`npx chrome-in-harness start` 会：
- 检测 server 是否已在运行（已运行则直接复用）
- 启动本地 server（WS `127.0.0.1:8765` ↔ MCP `http://127.0.0.1:12306/mcp`）
- 自动向 `~/.config/opencode/opencode.json` 写入 `chrome-in-harness` 的 remote MCP 条目

然后在客户端里让模型调 `ping`，应返回扩展版本与 userAgent。

### 发布渠道

- **npm**：`@chrome-in-harness/server`（server，含 `chrome-in-harness-server` bin）、`@chrome-in-harness/launcher`（`chrome-in-harness` CLI）、`@chrome-in-harness/protocol`（协议类型）
- **Chrome Web Store**：扩展以「Chrome in Harness」提交，权限与数据说明见 [docs/CWS_DISCLOSURE.md](docs/CWS_DISCLOSURE.md) 与 [docs/PRIVACY.md](docs/PRIVACY.md)
- **GitHub Releases**：tag `v*` 自动触发 npm 发布 + 扩展 zip 打包（.github/workflows/publish.yml）

## 开发步骤

> CI：push / PR 自动跑 lint + test + build（.github/workflows/ci.yml）。

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

# 4. 注册 MCP 到客户端
claude mcp add -s user chrome-in-harness --transport http http://127.0.0.1:12306/mcp
```

然后在客户端里让模型调 `ping`，应返回扩展版本与 userAgent。

## Roadmap

- **Phase 4** — 非受限执行 / 页面交互增强：如需绕过受限 `evaluate_script`，再评估 `chrome.scripting` + `world: "MAIN"` 注入面与 CSP 兼容
