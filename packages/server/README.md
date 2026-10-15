# @chrome-in-harness/server

[中文](#中文) | [English](#english)

本地无状态 MCP 端点 + WebSocket 桥：把 MCP 工具调用转发给 Chrome 扩展，把扩展的 CDP 执行结果送回 MCP 客户端。

## 中文

### 架构

```text
MCP 客户端 ──HTTP──▶ src/index.ts (http server, 仅 127.0.0.1)
                        └─▶ src/mcp.ts：每个请求新建 McpServer + StreamableHTTPServerTransport
                              └─▶ src/tools/*：24 个工具定义（schema 来自 protocol 包）
                                    └─▶ src/ws-bridge.ts：按消息 id 关联转发，30s 超时
                                          └─(ws://127.0.0.1:8765)──▶ Chrome 扩展
```

- **`src/mcp.ts`**：Streamable HTTP、**无状态模式**（`sessionIdGenerator: undefined`），每个 HTTP 请求独立装配 McpServer；不保存会话状态，重启不影响客户端
- **`src/tools/`**：工具定义按域分文件（`defs-tabs` / `defs-browser` / `defs-debug` / `defs-evaluate` / `defs-batch`）。职责只有三件事：声明工具（名称 + 描述 + `.shape` schema）→ `callBridge` 调桥并用 result schema 二次校验 → 把结果格式化成文本给模型。业务逻辑全部在扩展侧
- **`src/ws-bridge.ts`**：扩展是 WS **client** 主动连入；bridge 维护单条扩展连接，请求发出后按 `id` 挂起等待，30s 超时；工具超时/扩展断连会显式报错
- **`src/origin-guard.ts`**：WS 握手只接受 `chrome-extension://` Origin（浏览器强制写 Origin 且页面无法伪造，恶意网页无法顶替真扩展）；`CIC_EXTENSION_ID` 环境变量可进一步锁定到具体扩展 ID

### 安全边界

- MCP 端点**仅监听 127.0.0.1**，并开启 DNS rebinding 防护：强制校验 `Host` 为 `127.0.0.1:<port>` / `localhost:<port>`；存在 `Origin` 时一并校验（浏览器页面被拒，非浏览器 MCP 客户端放行）
- 本机进程仍可伪造 Origin 直连——这不是对抗本机恶意进程的防线，请勿把端口暴露到公网

### 运行

```bash
# 方式一：经 launcher（推荐，自动写 MCP 客户端配置）
npx @chrome-in-harness/launcher start

# 方式二：直接运行（bin: chrome-in-harness-server）
npx @chrome-in-harness/server
```

环境变量：`WS_PORT`（默认 8765）、`HTTP_PORT`（默认 12306）、`CIC_EXTENSION_ID`（可选，锁定扩展）。
注意：扩展内的 WS 地址与 manifest host permission 是写死的默认端口，只改 server 环境变量不会让整个系统跟着变。

---

## English

A stateless local MCP endpoint plus a WebSocket bridge: it forwards MCP tool calls to the Chrome extension and returns CDP execution results to the MCP client.

### Architecture

```text
MCP client ──HTTP──▶ src/index.ts (http server, 127.0.0.1 only)
                        └─▶ src/mcp.ts: a fresh McpServer + StreamableHTTPServerTransport per request
                              └─▶ src/tools/*: 24 tool definitions (schemas from the protocol package)
                                    └─▶ src/ws-bridge.ts: correlate by message id, 30s timeout
                                          └─(ws://127.0.0.1:8765)──▶ Chrome extension
```

- **`src/mcp.ts`**: Streamable HTTP in **stateless mode** (`sessionIdGenerator: undefined`); a fresh McpServer is assembled per HTTP request. No session state — restarts are transparent to clients
- **`src/tools/`**: tool definitions grouped by domain (`defs-tabs` / `defs-browser` / `defs-debug` / `defs-evaluate` / `defs-batch`). Each def does exactly three things: declare the tool (name + description + `.shape` schema), call the bridge via `callBridge` with result-schema re-validation, and format the result as text for the model. All business logic lives in the extension
- **`src/ws-bridge.ts`**: the extension connects **in** as the WS client; the bridge holds a single extension connection, suspends each request by `id`, and times out after 30s. Timeouts and disconnects surface as explicit errors
- **`src/origin-guard.ts`**: the WS handshake only accepts `chrome-extension://` origins (the browser forces the Origin header and pages cannot forge it, so a malicious page cannot impersonate the real extension); set `CIC_EXTENSION_ID` to additionally pin one extension ID

### Security boundary

- The MCP endpoint listens on **127.0.0.1 only** with DNS-rebinding protection: `Host` must be `127.0.0.1:<port>` / `localhost:<port>`; when `Origin` is present it is validated too (browser pages are rejected, non-browser MCP clients pass)
- A local process can still forge an Origin — this is not a defense against local malware. Never expose the ports to a public network

### Run

```bash
# Option 1: via the launcher (recommended; also writes MCP client config)
npx @chrome-in-harness/launcher start

# Option 2: run directly (bin: chrome-in-harness-server)
npx @chrome-in-harness/server
```

Environment: `WS_PORT` (default 8765), `HTTP_PORT` (default 12306), `CIC_EXTENSION_ID` (optional pin).
Note: the extension's WS URL and its manifest host permission are hardcoded to the default ports — changing only the server env does not reconfigure the whole system.
