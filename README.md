# chrome-in-harness

[![CI](https://github.com/hcfw007/chrome-in-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/hcfw007/chrome-in-harness/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@chrome-in-harness/launcher)](https://www.npmjs.com/package/@chrome-in-harness/launcher)
[![Node](https://img.shields.io/node/v/@chrome-in-harness/launcher)](https://www.npmjs.com/package/@chrome-in-harness/launcher)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**中文** | [English](README.en.md)

Claude-in-Chrome 风格的开源浏览器 MCP：通过 Chrome 扩展，让支持 MCP 的 AI 客户端（OpenCode / Claude Code 等）操作你**真实的 Chrome profile**，复用已有登录态、cookie 和插件环境，无需另起 headless 浏览器或重新登录。

> **便利优先，强烈建议只在测试环境使用。**
> 本项目为降低浏览器自动化的使用成本，在安全性上做了明确取舍：操作发生在真实浏览器中，没有独立沙箱，点击、输入和提交会直接作用于已登录账号。
> 请使用专用测试 Chrome profile、测试账号和测试数据，避免连接生产后台、日常主力浏览器或含敏感信息的页面。域名白名单、受管标签页和脚本限制能减少误操作，但不构成完整安全隔离。

## 功能概览

- **看页面**：读取可访问性树快照、元素文本和截图（像素与 CSS 坐标一致），使用带版本的 ref 定位元素；`probe` / `get_html` 只读探查单个元素的状态与 outerHTML。
- **操作页面**：导航、刷新（可绕过缓存）、点击、悬停、滚动或滚动到指定元素、文本输入和快捷键；iframe / Canvas 等无法通过 ref 命中的目标可用坐标点击，并回报落点元素。
- **编辑代码**：支持保留多行缩进的输入，以及通过页面暴露的 Monaco API 全量写入编辑器；包含键盘通路检测和编辑器塌缩恢复。
- **管理标签页**：创建、切换、关闭标签页，或显式接管已有标签页；操作限定在 "Chrome in Harness" 受管组内。
- **标签页会话**：`ensure_tab` 提供可复用的标签句柄——每个 agent 固定用自己的标签，标签被关自动补建，避免标签越开越多。
- **批量执行**：`run_actions` 一次调用按顺序执行多个工具（如逐字符输入、点击序列），减少 MCP 往返。
- **等待与排查**：等待文本、选择器、URL、编辑器就绪、网络静默或指定接口返回，读取控制台消息及网络请求元数据（含耗时，不读响应体），执行受限页面 JS 表达式；错误带代码与下一步。
- **不打扰浏览**：新标签一律后台打开不抢焦点；输入通过焦点仿真在后台标签执行；需要人工操作（登录、验证码）时 agent 会提示你自行切换。

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

四个包（每个子包都有自己的 README，含更详细的架构说明）：

| 包 | README |
| --- | --- |
| `@chrome-in-harness/protocol` | [packages/protocol/README.md](packages/protocol/README.md) |
| `@chrome-in-harness/server` | [packages/server/README.md](packages/server/README.md) |
| `@chrome-in-harness/extension` | [packages/extension/README.md](packages/extension/README.md) |
| `@chrome-in-harness/launcher` | [packages/launcher/README.md](packages/launcher/README.md) |

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
- **标签页与域名边界**：浏览器执行前检查受管组和域名白名单；新域名默认弹出确认窗口。`add_allowlist_domain` 可直接写入白名单，其"仅在用户明确要求时使用"依赖客户端 / agent 遵守工具说明。
- **受限脚本**：`evaluate_script` 使用黑名单和表达式形态检查，限制常见网络、导航和动态执行 API；这是减少误用的护栏，不是 JS 沙箱，也不保证所有页面表达式无副作用。
- 扩展权限按需申请：`alarms`（SW keepalive）、`tabs` + `tabGroups`（tab 管理 / 受管组边界 / URL 变化失效 ref）、`storage`（域名白名单持久化）、`debugger`（CDP 会话，仅在 attach 时出现「正在调试」黄条）、`permissions`（`request_permission` 弹窗授权）；host permission 仅 loopback `127.0.0.1:8765`，运行时通过 `optional_host_permissions` 白名单授权目标站

这些限制不覆盖本机恶意进程：MCP 端点没有客户端身份认证，本机进程也可伪造 Origin 连接 WS。不要将本地端点暴露到公网或不可信网络。**强烈建议仅连接测试环境，并使用隔离的测试 profile 与账号。** 权限与数据处理细节见 [CWS_DISCLOSURE](docs/CWS_DISCLOSURE.md) 和 [PRIVACY](docs/PRIVACY.md)。

## 工具与行为细节

**工具集**（30 个）：`ping`、`reload_extension`、`navigate`、`reload`、`snapshot`、`click`、`click_at`、`hover`、`type`、`press_key`、`get_text`、`probe`、`get_html`、`wait_for_response`、`scroll`、`scroll_to`、`screenshot`、`tab_list`、`tab_new`、`ensure_tab`、`tab_select`、`tab_close`、`takeover_tab`、`run_actions`、`read_console`、`read_network`、`wait`、`add_allowlist_domain`、`evaluate_script`、`request_permission`。

- **read_console / read_network**：CDP 采集的 console 与网络请求元数据（含耗时与细分失败原因；响应体与请求头不采集，`data:` URL 不记录）。缓冲从 tab 首次被工具 attach 起积累
- **wait_for_response**：等 URL 含指定子串（可加 status / method）的请求完成，只看元数据；默认回看 2s，「先点击再等待」无竞态
- **probe / get_html**：按 ref / selector / 可见文本（三选一）只读探查元素——probe 回存在性、匹配数、可见性、rect、文本与白名单属性；get_html 回 outerHTML（默认 4000 字符，上限 20000）
- **wait**：等待文本 / CSS 选择器 / URL 子串出现（页面内 Promise 轮询，默认 8s 上限 30s），或 `networkIdle:true`（连续 500ms 无新请求）；条件至多一个，只传 `timeoutMs` 即纯延迟；超时返回 `{matched:false}` 而非报错
- **reload_extension**：仅开发态——从磁盘重新加载解压扩展（等同 `chrome://extensions` 点 ↻）并等待重连，代理可自行「构建 → 重载 → 验证」扩展代码；商店安装版本直接拒绝。不刷新工具 schema：改了工具参数还需重启 server 并让客户端重新拉取工具列表（见下文「MCP 升级后」）
- **scroll_to**：按 ref / CSS selector / 可见文本（三选一）把元素滚到视口中央，回执滚动后的视口 rect 与 `inViewport`
- **reload**：重新加载当前页并按 navigate 同款策略等待；`hard:true` 绕过 HTTP 缓存（验证部署，免去加随机 query 污染路由）；旧 ref 全部失效
- **screenshot**：按 1/dpr 缩放输出，图片像素 = 视口 CSS 像素，量到的坐标可直接给 `click_at`；附带 `width/height/dpr` 文本。缩放不可用时返回原图，文本会提示把坐标除以 dpr
- **add_allowlist_domain**：显式扩白名单（无确认窗口，直接生效）。一般无需手动调用——访问新域名会自动弹确认窗口
- **evaluate_script**：受限 `Runtime.evaluate` 执行页面上下文 JS。黑名单拒绝网络访问（fetch/XHR/WebSocket/sendBeacon）、eval/Function、导航（location/window.open）、document.write、debugger 与 `chrome.*`；`awaitPromise:true` 需 async IIFE；结果 JSON 序列化超限截断；以用户手势执行，脚本内 `element.click()` 触发的页面 `window.open` 不会被弹窗拦截
- **request_permission**：针对域名发起 `chrome.permissions.request` 原生授权弹窗，授予后同步写入 storage 白名单。仅当用户明确要求时调用
- **takeover_tab**：把已打开、未受管的用户 tab 收编进受管组（`tab_list` 标 `[managed:<groupId>]` 便于识别），对已受管的 tab 是空操作；仅在用户明确要求在该 tab 工作时调用，URL 必须已在白名单。不激活、不聚焦、不导航、不跨窗口搬 tab（只并入同窗口的受管组，否则在该窗口新建）；tab 在用户自建的其他分组里时拒绝并报 `TAB_IN_USER_GROUP`，不拆用户分组；接管的是用户正在看的页时结果会注明，提醒后续操作对用户可见
- **ensure_tab / run_actions**：见下文[标签页使用约定](#标签页使用约定)与[批量执行](#批量执行)

- **snapshot**：`chrome.debugger` + CDP `Accessibility.getFullAXTree`，渲染成 Playwright ariaSnapshot 风格的缩进文本，交互元素带 `[ref=eN-<token>]`；优先用 ref 交互，减少选择器漂移。坐标点击、当前焦点输入等场景可不使用 ref
- **快照降噪**：不输出 `InlineTextBox`、与父节点同名的 `StaticText`、图标字体字形；自定义可点控件（cursor:pointer / onclick 的 div/li/span）标 `[weak]` 并给 ref，但包着真实控件（如 antd 下拉外的两层 div）的无名包装层不给。`limit` 是**输出字符预算**（默认 60000）而非节点数；预算不够时先隐藏纯文本子树保住 ref，末尾提示说明丢了什么并给出建议的重试 `limit`
- **ref 生命周期**：ref 绑定 tab 的最近一次快照，格式 `e<N>-<token>`（token 编码 worker 代 + 快照版本）；导航/关 tab/debugger 分离即失效；跨 worker 代或过期一律显式 `STALE_REF`（拒绝静默错点）；同代快照更替时交互工具按元素身份自动重试一次；SW 被杀后报 `NO_SNAPSHOT` 引导重新 snapshot
- **click snapshot**：`click({ref, snapshot: true})` 点击后等两帧渲染（后台 tab 上限 300ms）再返回新快照，适合点击即重渲染、旧 ref 全部失效的页面，省一次 `snapshot` 往返；异步取数后才渲染的内容仍应先 `wait`。点击已生效但取快照失败时只提示失败、不报错，避免误重点
- **click_at**：ref 命中不了时（iframe/Canvas/icon-only 容器）的坐标点击兜底，视口 CSS 像素，越界显式报错；点击前 hit-test，回执落点元素与最近可交互祖先（可区分坐标偏移 / 被遮挡 / handler 无反应）
- **press_key**：单键/组合键（`ctrl`/`alt`/`shift`/`meta` + 键名，支持 F1-F24），可选先 focus 指定 ref；派发前有默认动作探针——临时离屏输入框验证按键真的产生字符插入（监听器探针检测不出「事件送达但默认动作被丢弃」的假活，resize/失焦后的典型死法），死了自动重开焦点仿真/激活自愈，仍死显式报 `KEY_PIPELINE_DEAD`
- **get_text**：优先读 AX value（虚拟滚动编辑器全文唯一可靠读数），innerText 兜底，上限 8KB
- **type**：`mode="insert"`（默认）/ `mode="verbatim"`（Monaco 类编辑器逐行 insertText 还原缩进，无 trim）/ `mode="set"`（monaco `setValue` 原子写整个缓冲——绕开键盘/焦点/IME 通路，窗口失焦、键路死亡、编辑器塌缩都不影响；ref 可省，单编辑器页面自动选中）；焦点不在可编辑元素时显式报 `INPUT_NOT_LANDED` 而非静默假成功；返回插入点概要 `{line, col}` 供模型自查
- **wait editorRendered**：Monaco 渲染完成 = 高度 > 40px 且宽度 > 200px 且有非空 view-line——resize 后塌缩成 5×5 窄条的假就绪不再放过；检测到塌缩自动按父容器尺寸强制 `layout()` 重排救回（无参 layout 会按自身窄宽度自我维持，必须显式传维度）
- **输入路径**：常规点击与输入通过 CDP `Input.*` 派发浏览器事件；`type mode="set"` 则直接调用 Monaco API，不模拟逐键输入。不保证网站将自动化操作视为人工操作
- **域名白名单 + 运行时确认**：`chrome.storage.local` 持久化，扩展侧在 attach 前校验，空名单 = 拒绝全部；规则 `example.com` 匹配自身与任意深度子域。访问未授权域名时**自动弹出确认窗口**（显示域名与来源 URL，允许/拒绝），工具即时返回 `DOMAIN_CONFIRMATION_REQUIRED`（非阻塞），用户点「允许」后重试即通过——无需手动改配置
- **受管组复用**：`tab_new` / `takeover_tab` 优先并入本窗口既有的 "Chrome in Harness" 组（组标题带 `⏳/✅/❌` 操作状态前缀时也识别为同一组），避免每开一个 tab 就新建组
- **代价（已接受）**：attach 期间 Chrome 显示「正在调试」黄条；目标 tab 打开 DevTools 会顶掉扩展会话，工具报 `DEBUGGER_BUSY`，关闭 DevTools 后自动恢复
- **后台操作（自动处理，不抢前台）**：CDP `Input.*` 在后台 tab 上会被静默丢弃；输入类工具派发前开 `Emulation.setFocusEmulationEnabled` 焦点仿真（Playwright / Claude-in-Chrome 同款），让后台 tab 直接接收输入，**不激活 tab、不打断用户当前视图**；仿真不可用时回退激活 tab；窗口最小化时自动恢复并聚焦，恢复失败报 `WINDOW_NOT_INTERACTIVE`

## 安装与运行

整体分四步：**① 启动本地 server → ② 安装 Chrome 扩展 → ③ 注册 MCP 客户端 → ④ 验证**。扩展**没有上架 Chrome Web Store**，第 ② 步需要手动加载，请仔细按流程操作。

### 前置要求

- Node.js ≥ 20（推荐 22）
- Chrome / Chromium 系浏览器
- 强烈建议使用**专用测试 Chrome profile**（Chrome → 右上角头像 → 添加新用户），与日常浏览隔离

### 第 ① 步：启动本地 server

```bash
npx @chrome-in-harness/launcher start
```

这一条命令会：

- 检测 server 是否已在运行（已运行则直接复用）
- 启动本地 server（WS `127.0.0.1:8765` ↔ MCP `http://127.0.0.1:12306/mcp`）
- 自动向 `~/.config/opencode/opencode.json` 写入 `chrome-in-harness` 的 remote MCP 条目（已有同名条目会保留；配置文件无法读取或非法时会报错退出，不覆盖原文件）

`start` 是**前台进程**，关掉终端即停止。如需长期在线，见下文[常驻服务](#常驻服务可选)。

### 第 ② 步：安装 Chrome 扩展（手动加载）

> 扩展未上架 Chrome Web Store，需以"开发者模式 + 加载已解压的扩展程序"方式安装。扩展来源二选一：

**方式 A：GitHub Releases 下载 zip（推荐使用者）**

1. 到 [Releases 页面](https://github.com/hcfw007/chrome-in-harness/releases) 下载 `chrome-in-harness-extension.zip`
2. **解压到一个长期保留的固定目录**（例如 `~/chrome-in-harness-extension`）。注意：解压目录不能删除或移动，Chrome 是"引用"这个目录加载扩展的，目录没了扩展就失效
3. Chrome 打开 `chrome://extensions`
4. 打开右上角的 **开发者模式** 开关
5. 点击左上角 **加载已解压的扩展程序**，选择上一步的解压目录（选目录本身，不是 zip）
6. 列表出现 **Chrome in Harness** 即安装成功

**方式 B：源码构建（开发者）**

```bash
git clone https://github.com/hcfw007/chrome-in-harness.git
cd chrome-in-harness
npm ci && npm run build:extension
```

然后同方式 A 的 3-5 步，选择目录改为 `packages/extension/.output/chrome-mv3`。

**扩展升级方法**

- 方式 A：下载新版本 zip → 解压**覆盖同一目录** → 回到 `chrome://extensions`，在 Chrome in Harness 卡片上点 **刷新 ↻** 图标
- 方式 B：`git pull && npm ci && npm run build:extension` → 同样点刷新图标

**首次使用提示**

- 扩展安装后即自动连接本地 server（`ws://127.0.0.1:8765`），无需配置；server 后启动也没关系，扩展会自动重连
- 扩展的「扩展程序选项」页可维护域名白名单和访问模式
- 首次访问白名单外的域名时，会弹出确认窗口，点「允许」即加入白名单

### 第 ③ 步：注册 MCP 客户端

- **OpenCode**：第 ① 步的 `start` 已自动写入全局配置，重开客户端会话即可
- **其他 MCP 客户端**（Claude Code 等）：手动注册 remote MCP 端点

  ```json
  {
    "mcpServers": {
      "chrome-in-harness": {
        "type": "http",
        "url": "http://127.0.0.1:12306/mcp"
      }
    }
  }
  ```

### 第 ④ 步：验证全链路

```bash
npx @chrome-in-harness/launcher doctor
```

应看到：

```text
[✓] server 已在运行 (http://127.0.0.1:12306/mcp)
[✓] 扩展已连接（ping 通过）
```

也可以直接在 MCP 客户端里让模型调 `ping`，应返回扩展版本与 userAgent。

> **MCP 升级后要让客户端重新拉取工具列表**：opencode / Claude Code 等客户端在连接时缓存工具 schema，运行中不会热更新。服务端升级新参数/新工具后，老连接仍按旧 schema 校验并拦截新参数。重启客户端会话即可；OpenCode 也可以不重启会话，对该 MCP server 先断开再重连（`/mcps` 里操作，或 `opencode api post '/api/experimental/mcp/<name>/disconnect'` 再 `.../connect`）。ref 格式同样注意：快照 ref 带 token 后缀（如 `e3-a7k2`），跨会话/跨 worker 重启的旧 ref 会被显式拒绝（`STALE_REF`），重新 snapshot 即可。

### 常驻服务（可选）

`start` 是前台进程，终端关闭或机器重启后即结束。需要长期在线可注册为用户级服务（登录自启 + 崩溃自动拉起）：

```bash
npx @chrome-in-harness/launcher service install    # macOS launchd / Linux systemd --user
npx @chrome-in-harness/launcher service status     # 查看安装与运行状态
npx @chrome-in-harness/launcher service uninstall  # 停止并移除
```

- macOS：写入 `~/Library/LaunchAgents/com.chrome-in-harness.server.plist`（`RunAtLoad` + `KeepAlive`），日志在 `~/Library/Logs/chrome-in-harness-server.log`
- Linux：写入 `~/.config/systemd/user/chrome-in-harness.service`（`Restart=always`），日志走 `journalctl --user -u chrome-in-harness.service`
- Windows 暂不支持，请用 `start` 常开终端（或 `pm2` 等进程守护）
- 已安装时再次 `install` 会拒绝覆盖，需先 `uninstall`；server 重启后 Chrome 扩展会自动重连

### 标签页使用约定

agent 应优先使用 `ensure_tab`，保存返回的 `{tabId, url, reused}`，后续操作始终显式传入自己的 `tabId`。
再次调用 `ensure_tab({tabId, url?})` 时，原标签存在且仍受管则复用，不导航、不切前台；已关闭时后台补建并返回新 ID。
`url` 仅用于创建，复用后需要换页面应调用 `navigate`；不传 `url` 时新标签开在 `about:blank`。标签被用户移出受管组会报错，不自动接管或补建。
不同 agent 各自维护标签 ID，只有明确需要多标签时才使用 `tab_new`；服务不提供 agent 身份识别或独占锁。

新建标签页（`tab_new`）默认后台打开，不抢占当前页面。需要登录、验证码或人工检查时，agent 应通知用户自行切换；仅当用户明确要求帮忙切换时才调用 `tab_select`。

### 批量执行

重复性的连续操作（如逐字符 `press_key` 输入）可用 `run_actions` 在**一次调用**里批量执行：
传 `actions: [{tool, params}, ...]`，顶层 `tabId` 会注入未自带 `tabId` 的步骤。步骤按顺序执行、后续步骤能看到前序结果；
默认在首个失败处停止，`continueOnError: true` 则继续并保留每步错误。单次最多 50 步，禁止嵌套 `run_actions`，也不支持在批量里调用 `screenshot` 和 `reload_extension`。
每一步的参数在扩展侧按该工具的协议 schema 校验（与单独调用一致，例如 `click_at` 仍须带 `coordinates: true`）；批量的总超时按各步 `timeoutMs` 之和放宽。

### 错误格式

本服务的错误统一为 `CODE: 原因 — 下一步`，按「下一步」处理即可。常见的：

| 代码 | 含义 |
|---|---|
| `DOMAIN_CONFIRMATION_REQUIRED` | 已弹出域名确认窗口，等用户点「允许」后重试 |
| `TAB_NOT_MANAGED` / `TAB_CLOSED` / `TAB_IN_USER_GROUP` | 标签不在受管组 / 已关闭 / 在用户自建分组里（`takeover_tab` 不会拆它） |
| `STALE_REF` / `NO_SNAPSHOT` | ref 过期或扩展重启过，重新 snapshot |
| `EXTENSION_DISCONNECTED` | 扩展未连接；刚断开时多半在重连，稍等几秒重试 |
| `TOOL_TIMEOUT` | 扩展超时未回包：页面卡住、有弹窗挡住，或 DevTools 占用了 debugger |
| `DEBUGGER_BUSY` | 该标签已打开 DevTools，关掉后重试 |

不带这类代码的报错（例如权限弹窗被拒、工具列表整体消失）来自 MCP 客户端或宿主，不是本服务。

### 域名访问模式

默认按域名白名单限制访问。扩展选项页提供「允许所有域名」开关，默认关闭，开启前需确认风险。
开启后允许受管标签组内所有 HTTP/HTTPS 网站，不再逐域名确认；Chrome 内部页、扩展页及本地文件仍不允许。
该设置保存在当前扩展的本地存储中，重载后保持。原白名单不会被清除，关闭开关后立即恢复生效。
此模式会使用真实登录状态，可能读取敏感内容或提交真实数据，仅建议在专用测试浏览器配置与测试账号中开启。

## 发布渠道

- **npm**：`@chrome-in-harness/server`（server，含 `chrome-in-harness-server` bin）、`@chrome-in-harness/launcher`（`chrome-in-harness` CLI）、`@chrome-in-harness/protocol`（协议类型）
- **GitHub Releases**：tag `v*` 自动触发 npm 发布 + 扩展 zip 打包（.github/workflows/publish.yml），扩展从 Releases 的 `chrome-in-harness-extension.zip` 安装
- **Chrome Web Store**：暂未上架；权限与数据处理说明见 [docs/CWS_DISCLOSURE.md](docs/CWS_DISCLOSURE.md) 与 [docs/PRIVACY.md](docs/PRIVACY.md)

## 开发步骤

> CI：push / PR 自动跑 lint → test → 扩展 typecheck → build（.github/workflows/ci.yml）。

```bash
# 1. 使用 Node 22，与 CI 保持一致；在仓库根目录安装与验证
npm ci
npm run lint           # @ddyscn/lint-config（ESLint flat config）
npm test               # 构建 protocol / extension，并运行四包 Vitest
npm run typecheck:extension # 构建扩展并执行独立的 TypeScript 检查
npm run build          # protocol → server → extension → launcher
# 扩展产物：packages/extension/.output/chrome-mv3
# 自动修复格式 / lint：npm run lint:fix

# 2. 起本地 server
npm run dev:server

# 3. Chrome 加载扩展：见上文「第 ② 步 · 方式 B」
#    修改扩展后运行 npm run build:extension，并在 chrome://extensions 点刷新

# 4. 注册 MCP 到客户端：见上文「第 ③ 步」
```

打包本地发版产物（三个 npm tarball + 扩展 zip，输出到 `dist-release/`）：

```bash
npm run pack
```

## Roadmap

- **Phase 4** — 非受限执行 / 页面交互增强：如需绕过受限 `evaluate_script`，再评估 `chrome.scripting` + `world: "MAIN"` 注入面与 CSP 兼容
