# chrome-in-harness

Claude-in-Chrome 风格的开源浏览器 MCP：通过 Chrome 扩展，让支持 MCP 的 AI 客户端（OpenCode / Claude Code 等）操作你**真实的 Chrome profile**，复用已有登录态、cookie 和插件环境，无需另起 headless 浏览器或重新登录。

> **便利优先，强烈建议只在测试环境使用。**
> 本项目为降低浏览器自动化的使用成本，在安全性上做了明确取舍：操作发生在真实浏览器中，没有独立沙箱，点击、输入和提交会直接作用于已登录账号。
> 请使用专用测试 Chrome profile、测试账号和测试数据，避免连接生产后台、日常主力浏览器或含敏感信息的页面。域名白名单、受管标签页和脚本限制能减少误操作，但不构成完整安全隔离。

## 功能概览

- **看页面**：读取可访问性树快照、元素文本和截图，使用带版本的 ref 定位元素。
- **操作页面**：导航、点击、悬停、滚动、文本输入和快捷键；iframe / Canvas 等无法通过 ref 命中的目标可用坐标点击。
- **编辑代码**：支持保留多行缩进的输入，以及通过页面暴露的 Monaco API 全量写入编辑器；包含键盘通路检测和编辑器塌缩恢复。
- **管理标签页**：创建、切换、关闭标签页，或显式接管已有标签页；操作限定在 “Chrome in Harness” 受管组内。
- **等待与排查**：等待文本、选择器、URL 或编辑器就绪，读取控制台消息及网络请求元数据，执行受限页面 JS 表达式。
- **减少操作打扰**：优先通过焦点仿真在后台标签页执行输入；恢复失败时可能激活标签页或窗口。

## 架构

```text
AI / MCP 客户端（OpenCode、Claude Code 等）
        │ Streamable HTTP：工具调用 / 结果
        ▼
本地 Node.js server · http://127.0.0.1:12306/mcp
        │ WebSocket：请求转发 / 响应关联
        │ ws://127.0.0.1:8765（扩展主动连接）
        ▼
Chrome 扩展 · MV3 service worker / WXT
        │ chrome.debugger / Chrome DevTools Protocol
        ▼
真实 Chrome profile 中的受管标签页
```

四个包：`@chrome-in-harness/protocol`（两端共用的 WS 协议定义、zod schema 与类型守卫）、`@chrome-in-harness/server`（WS 桥 + MCP 端点）、`@chrome-in-harness/extension`（MV3 扩展）、`@chrome-in-harness/launcher`（`chrome-in-harness` CLI）。

- 扩展 service worker 作为 WS **client** 主动连 `ws://127.0.0.1:8765`（无需 Chrome 额外暴露端口，连接由扩展发起）
- server 在 `http://127.0.0.1:12306/mcp` 暴露 MCP（Streamable HTTP，无状态模式）；收到 tool call 后通过 WS 转发给扩展，按消息 `id` 关联等待响应，超时 30s
- WS 协议 v1：请求 `{ v: 1, id, tool, params }`，响应 `{ v: 1, id, ok, result | error }`；定义与守卫集中在 `@chrome-in-harness/protocol`，server 与扩展共用一份
- 一次调用的路径：客户端选择工具 → server 转发 WS 请求 → 扩展解析参数并检查标签页 / 域名边界 → CDP 执行 → 结果经 server 返回客户端。浏览器操作由扩展执行，server 不另起浏览器实例。
- 扩展与 server 之间的桥接运行在本机；页面快照、截图、日志等工具结果会返回 MCP 客户端，是否继续发送给远程模型取决于客户端配置。

## 安全取舍与边界

这是面向开发、调试和测试的便利工具，不是生产环境的安全隔离方案。复用真实登录态意味着 agent 可能以当前账号权限执行操作；网页内容或模型判断也可能误导后续调用。项目没有对每次点击、输入或提交做人工审批，域名授权也不等于对站点内每个动作授权。

已有的限制包括：

- **WS 握手校验 Origin**：只接受 `chrome-extension://` 来源。浏览器强制写入 Origin 且页面无法伪造，因此恶意网页无法连上 `127.0.0.1:8765` 顶掉真扩展并接管 tool call。设 `CIC_EXTENSION_ID` 可进一步锁定到具体扩展 ID
- **MCP 端点开启 DNS rebinding 防护**：强制校验 Host 为 `127.0.0.1:12306` / `localhost:12306`；Origin 存在时一并校验（浏览器页面会被拒，非浏览器 MCP 客户端正常放行）
- **标签页与域名边界**：浏览器执行前检查受管组和域名白名单；新域名默认弹出确认窗口。`add_allowlist_domain` 可直接写入白名单，其“仅在用户明确要求时使用”依赖客户端 / agent 遵守工具说明。
- **受限脚本**：`evaluate_script` 使用黑名单和表达式形态检查，限制常见网络、导航和动态执行 API；这是减少误用的护栏，不是 JS 沙箱，也不保证所有页面表达式无副作用。
- 扩展权限按需申请：`alarms`（SW keepalive）、`tabs` + `tabGroups`（tab 管理 / 受管组边界 / URL 变化失效 ref）、`storage`（域名白名单持久化）、`debugger`（CDP 会话，仅在 attach 时出现「正在调试」黄条）、`permissions`（`request_permission` 弹窗授权）；host permission 仅 loopback `127.0.0.1:8765`，运行时通过 `optional_host_permissions` 白名单授权目标站

这些限制不覆盖本机恶意进程：MCP 端点没有客户端身份认证，本机进程也可伪造 Origin 连接 WS。不要将本地端点暴露到公网或不可信网络。**强烈建议仅连接测试环境，并使用隔离的测试 profile 与账号。** 权限与数据处理细节见 [CWS_DISCLOSURE](docs/CWS_DISCLOSURE.md) 和 [PRIVACY](docs/PRIVACY.md)。

## 工具与行为细节

**工具集**（22 个）：`ping`、`navigate`、`snapshot`、`click`、`click_at`、`hover`、`type`、`press_key`、`get_text`、`scroll`、`screenshot`、`tab_list`、`tab_new`、`tab_select`、`tab_close`、`takeover_tab`、`read_console`、`read_network`、`wait`、`add_allowlist_domain`、`evaluate_script`、`request_permission`。

- **read_console / read_network**：CDP 采集的 console 与网络请求元数据（响应体不采集）。缓冲从 tab 首次被工具 attach 起积累
- **wait**：等待文本 / CSS 选择器 / URL 子串出现（页面内 Promise 轮询，默认 8s 上限 30s），超时返回 `{matched:false}` 而非报错
- **add_allowlist_domain**：显式扩白名单（无确认窗口，直接生效）。一般无需手动调用——访问新域名会自动弹确认窗口
- **evaluate_script**：受限 `Runtime.evaluate` 执行页面上下文 JS。黑名单拒绝网络访问（fetch/XHR/WebSocket/sendBeacon）、eval/Function、导航（location/window.open）、document.write、debugger 与 `chrome.*`；`awaitPromise:true` 需 async IIFE；结果 JSON 序列化超限截断
- **request_permission**：针对域名发起 `chrome.permissions.request` 原生授权弹窗，授予后同步写入 storage 白名单。仅当用户明确要求时调用
- **takeover_tab**：把已打开的用户 tab 收编进受管组（`tab_list` 标 `[managed:<groupId>]` 便于识别）；仅在用户明确要求在该 tab 工作时调用，URL 必须已在白名单

- **snapshot**：`chrome.debugger` + CDP `Accessibility.getFullAXTree`，渲染成 Playwright ariaSnapshot 风格的缩进文本，交互元素带 `[ref=eN-<token>]`；优先用 ref 交互，减少选择器漂移。坐标点击、当前焦点输入等场景可不使用 ref
- **ref 生命周期**：ref 绑定 tab 的最近一次快照，格式 `e<N>-<token>`（token 编码 worker 代 + 快照版本）；导航/关 tab/debugger 分离即失效；跨 worker 代或过期一律显式 `STALE_REF`（拒绝静默错点）；同代快照更替时交互工具按元素身份自动重试一次；SW 被杀后报 `NO_SNAPSHOT` 引导重新 snapshot
- **click_at**：ref 命中不了时（iframe/Canvas/icon-only 容器）的坐标点击兜底，视口 CSS 像素，越界显式报错
- **press_key**：单键/组合键（`ctrl`/`alt`/`shift`/`meta` + 键名，支持 F1-F24），可选先 focus 指定 ref；派发前有默认动作探针——临时离屏输入框验证按键真的产生字符插入（监听器探针检测不出「事件送达但默认动作被丢弃」的假活，resize/失焦后的典型死法），死了自动重开焦点仿真/激活自愈，仍死显式报 `KEY_PIPELINE_DEAD`
- **get_text**：优先读 AX value（虚拟滚动编辑器全文唯一可靠读数），innerText 兜底，上限 8KB
- **type**：`mode="insert"`（默认）/ `mode="verbatim"`（Monaco 类编辑器逐行 insertText 还原缩进，无 trim）/ `mode="set"`（monaco `setValue` 原子写整个缓冲——绕开键盘/焦点/IME 通路，窗口失焦、键路死亡、编辑器塌缩都不影响；ref 可省，单编辑器页面自动选中）；焦点不在可编辑元素时显式报 `INPUT_NOT_LANDED` 而非静默假成功；返回插入点概要 `{line, col}` 供模型自查
- **wait editorRendered**：Monaco 渲染完成 = 高度 > 40px 且宽度 > 200px 且有非空 view-line——resize 后塌缩成 5×5 窄条的假就绪不再放过；检测到塌缩自动按父容器尺寸强制 `layout()` 重排救回（无参 layout 会按自身窄宽度自我维持，必须显式传维度）
- **输入路径**：常规点击与输入通过 CDP `Input.*` 派发浏览器事件；`type mode="set"` 则直接调用 Monaco API，不模拟逐键输入。不保证网站将自动化操作视为人工操作
- **域名白名单 + 运行时确认**：`chrome.storage.local` 持久化，扩展侧在 attach 前校验，空名单 = 拒绝全部；规则 `example.com` 匹配自身与任意深度子域。访问未授权域名时**自动弹出确认窗口**（显示域名与来源 URL，允许/拒绝），工具即时返回 `DOMAIN_CONFIRMATION_REQUIRED`（非阻塞），用户点「允许」后重试即通过——无需手动改配置
- **受管组复用**：`tab_new` / `takeover_tab` 优先并入本窗口既有的 "Chrome in Harness" 组（组标题带 `⏳/✅/❌` 操作状态前缀时也识别为同一组），避免每开一个 tab 就新建组
- **代价（已接受）**：attach 期间 Chrome 显示「正在调试」黄条；目标 tab 打开 DevTools 会顶掉扩展会话，工具报 `DEBUGGER_BUSY`，关闭 DevTools 后自动恢复
- **后台操作（自动处理，不抢前台）**：CDP `Input.*` 在后台 tab 上会被静默丢弃；输入类工具派发前开 `Emulation.setFocusEmulationEnabled` 焦点仿真（Playwright / Claude-in-Chrome 同款），让后台 tab 直接接收输入，**不激活 tab、不打断用户当前视图**；仿真不可用时回退激活 tab；窗口最小化时自动恢复并聚焦，恢复失败报 `WINDOW_NOT_INTERACTIVE`

### 实战技巧（SPA / LeetCode 类站点，实测沉淀）

- **写解法**：`type mode="set"` 一步全量写盘，比 click → Ctrl+A → type 更稳更快；写入前自动检测并恢复塌缩布局（返回 `layoutRecovered:true` 可观测），无需再手动 rect 预检 + layout()；提交用 Run/Submit 按钮 ref 点击
- **水合竞态**：React 站点刚加载完时点击会被静默吞掉（handler 尚未接线）——`navigate` 后先 `wait`（app 级 marker）再首次点击
- **verdict 真值**：LeetCode 2026 UI 提交后自动跳转 `/submissions/detail/<id>/`，结果面板经常不渲染（非 AC 尤甚）；唯一可靠 oracle 是直接 `navigate` 到 `/submissions/detail/<id>/v2/check/` 读 JSON（同源即在白名单内）
- **707/被拒诊断**：从提交后的 URL 或页面获取 submission id，再 `navigate` 到 `/submissions/detail/<id>/v2/check/` 查看 `ai_judge_message`。`read_network(urlFilter:"submit")` 只能辅助检查请求状态，不能读取提交响应体
- **AC 判定**：`wait(text:"Accepted")` 有假阳性（题目统计区常驻 "Accepted 2.3M/4M" 字样）；`wait(text:"Beats")` 才是 AC-only 信号，Run 结果用 `wait(text:"Runtime")`

## 安装与使用

两种方式：**npm 快速安装**（推荐）或 **GitHub Release / 源码**。

> **MCP 升级后必须重启客户端会话**：opencode / Claude Code 等客户端在会话启动时注册工具 schema，
> 运行中不会随服务端 `tools/list` 变化热更新（不监听 `tools/list_changed`）。服务端升级新参数/新工具后，
> 老会话仍按旧 schema 校验并拦截新参数——重启会话即可。ref 格式同样注意：快照 ref 带 token
> 后缀（如 `e3-a7k2`），跨会话/跨 worker 重启的旧 ref 会被显式拒绝（`STALE_REF`），重新 snapshot 即可。

### npm 快速安装

```bash
# 1. 启动本地 server 并自动写入 OpenCode 全局配置
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
# 1. 使用 Node 22，与 CI 保持一致；在仓库根目录安装与验证
npm ci
npm run lint           # @ddyscn/lint-config（ESLint flat config）
npm test               # 构建 protocol / extension，并运行四包 Vitest
npm run build          # protocol → server → extension → launcher
# 扩展产物：packages/extension/.output/chrome-mv3
# 自动修复格式 / lint：npm run lint:fix

# 2. 起本地 server
npm run dev:server

# 3. Chrome 加载扩展：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#    选择 packages/extension/.output/chrome-mv3
#    修改扩展后运行 npm run build:extension，并在 Chrome 中重新加载扩展

# 4. 注册 MCP 到客户端（opencode 示例，~/.config/opencode/opencode.json）
#    { "mcp": { "chrome-in-harness": { "type": "remote", "url": "http://127.0.0.1:12306/mcp" } } }
#    或直接跑 `npx chrome-in-harness start` 自动写入该条目
```

打包本地发版产物（三个 npm tarball + 扩展 zip，输出到 `dist-release/`）：

```bash
npm run pack
```

然后在客户端里让模型调 `ping`，应返回扩展版本与 userAgent。

## Roadmap

- **Phase 4** — 非受限执行 / 页面交互增强：如需绕过受限 `evaluate_script`，再评估 `chrome.scripting` + `world: "MAIN"` 注入面与 CSP 兼容
