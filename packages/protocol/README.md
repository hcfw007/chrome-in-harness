# @chrome-in-harness/protocol

[中文](#中文) | [English](#english)

两端共用的协议与工具契约包：WebSocket 消息定义、全部工具的参数/结果 zod schema、错误码与 ref 格式。server 与 extension 都依赖它，保证两端永不漂移。

## 中文

### WS 协议 v1（server ↔ extension）

- 请求（server → extension）：`{ v: 1, id, tool, params }`
- 响应（extension → server）：`{ v: 1, id, ok: true, result } | { v: 1, id, ok: false, error }`
- 握手（extension → server）：`{ v: 1, type: "hello", version, userAgent }`

`src/index.ts` 提供消息类型与类型守卫（`isWsRequest` / `isWsResponse` / `isWsHello` / `parseExtensionMessage`），边界输入先守卫再使用。

### 工具契约（src/tools.ts）

- **参数/结果 schema**：每个工具的 zod schema。server 用 params 的 `.shape` 注册 MCP `inputSchema`，并用 result schema 对 WS 返回值做二次校验（`callBridge`）；extension 在 dispatch 边界用同一份定义校验
- **`TOOL_NAMES`**：全部工具名的唯一真源（24 个）。server 的工具定义清单与 extension 的注册表都有测试断言与之完全一致，漏注册会直接红
- **`ACTION_STEP_TOOLS`**：`run_actions` 允许的步骤工具（排除自身防递归、排除 screenshot 防二进制内嵌）
- **`REF_PATTERN`**：快照 ref 格式 `e<N>-<token>`（如 `e3-a7k2`），token 编码 worker 代 + 快照版本；无 token 的旧格式可通过 schema 但 extension 会显式拒绝
- **`TOOL_ERROR_CODES`**：扩展侧错误码（`STALE_REF` / `NO_SNAPSHOT` / `TAB_NOT_MANAGED` / `DOMAIN_CONFIRMATION_REQUIRED` / `KEY_PIPELINE_DEAD` 等），拼进错误消息前缀透传给模型自纠

### 构建

- 仅运行时依赖 `zod`；NodeNext ESM，源码相对导入带 `.js` 后缀
- `npm run build` 产出 `dist/`；**下游包（server / extension / launcher）解析的是 `dist` 而非源码**，改动本包后必须先 `npm run build -w @chrome-in-harness/protocol`

---

## English

The shared contract package used by both ends: WebSocket message definitions, zod schemas for every tool's params/result, error codes, and the ref format. Both `@chrome-in-harness/server` and `@chrome-in-harness/extension` depend on it so the two ends can never drift.

### WS protocol v1 (server ↔ extension)

- Request (server → extension): `{ v: 1, id, tool, params }`
- Response (extension → server): `{ v: 1, id, ok: true, result } | { v: 1, id, ok: false, error }`
- Handshake (extension → server): `{ v: 1, type: "hello", version, userAgent }`

`src/index.ts` exports the message types and type guards (`isWsRequest` / `isWsResponse` / `isWsHello` / `parseExtensionMessage`); boundary input is guarded before use.

### Tool contracts (src/tools.ts)

- **Params/result schemas**: one zod schema per tool. The server registers each params `.shape` as the MCP `inputSchema` and re-validates WS return values against the result schema (`callBridge`); the extension validates against the same definitions at its dispatch boundary
- **`TOOL_NAMES`**: the single source of truth for all 24 tool names. Tests on both the server tool defs and the extension registry assert exact equality — a missing registration fails CI
- **`ACTION_STEP_TOOLS`**: tools allowed as `run_actions` steps (excludes `run_actions` itself to prevent recursion, and `screenshot` to keep binaries out of batch results)
- **`REF_PATTERN`**: snapshot ref format `e<N>-<token>` (e.g. `e3-a7k2`), where the token encodes the worker era + snapshot version; legacy token-less refs pass the schema but are explicitly rejected by the extension
- **`TOOL_ERROR_CODES`**: extension-side error codes (`STALE_REF` / `NO_SNAPSHOT` / `TAB_NOT_MANAGED` / `DOMAIN_CONFIRMATION_REQUIRED` / `KEY_PIPELINE_DEAD`, …) prefixed onto error messages so the model can self-correct

### Build

- Only runtime dependency is `zod`; NodeNext ESM with `.js` suffixes on relative imports
- `npm run build` emits `dist/`; **downstream packages resolve `dist`, not source** — after changing this package, run `npm run build -w @chrome-in-harness/protocol` first
