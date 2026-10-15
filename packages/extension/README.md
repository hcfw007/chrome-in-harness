# @chrome-in-harness/extension (Chrome in Harness)

[中文](#中文) | [English](#english)

MV3 扩展（WXT 构建）：所有浏览器操作的实际执行端。通过 `chrome.debugger`/CDP 驱动受管标签组内的页面。

> 本包是 `private`，不发 npm。安装方式见仓库根 [README](../../README.md)：未上架 Chrome Web Store，需开发者模式加载已解压目录。

## 中文

### 目录结构

- **`entrypoints/`**（WXT 入口）
  - `background.ts`：MV3 service worker，即 WS **client**。事件监听器同步注册（URL 变化失效 ref、tab 移除 / debugger 分离时清理 refs 与缓冲）
  - `confirm/`：域名确认弹窗页——访问白名单外域名时展示待确认域名，允许/拒绝
  - `options/`：选项页——域名白名单维护 + 「允许所有域名」开关（默认关闭，开启需页面内风险确认）
- **`lib/`**（核心逻辑，全部可单测，大部分模块零 chrome.* 依赖）
  - 传输层：`connection`（WS 连接 / 重连 / 消息循环）、`cdp`（debugger 会话 attach 管理）、`cdp-commands`（CDP 高层封装：AX 树、输入派发、焦点仿真、Monaco 读写、探针）
  - 快照与 ref：`ax-types` / `ax-snapshot`（AX 树 → Playwright ariaSnapshot 风格文本）、`ref-store`（tab → 快照 → ref 映射与历史）、`snapshot-version` / `worker-era`（版本水位线与代际 token）、`ref-suggest`（相似 ref 建议）、`weak-interactive`（cursor:pointer 等弱交互候选扫描）
  - 输入：`keymap`（键名 → CDP 参数）、`verbatim`（保留缩进的逐行插入规划）
  - 安全：`site-filter`（白名单匹配纯逻辑）、`whitelist`（storage 持久化）、`domain-confirmation` / `domain-access`（运行时确认与全域开关）、`script-guard`（evaluate_script 黑名单）、`permission-grant`
  - 采集：`console-buffer` / `network-buffer`（attach 期间的有界内存缓冲）
  - 其他：`tab-group`（受管组边界唯一真源）、`serialize`
- **`tools/`**：工具实现与注册表。`registry.ts` 是唯一注册/调用路径（组状态 ⏳/✅/❌ 标记、`ping` 特例）；`access.ts` 是**鉴权编排**——先受管组检查、再域名白名单检查，全部通过才允许触碰 `chrome.debugger`；`ref-recovery.ts` 实现 stale ref 的同元素身份重试；`batch.ts` 是 `run_actions` 批量执行

### 关键机制

- **双层边界，顺序严格**：① tab 必须在 "Chrome in Harness" 受管组内（用户拖出组即时收回权限）；② tab URL 必须命中域名白名单（未命中弹确认窗口，空名单拒绝全部）。两层都过才 attach debugger
- **ref 生命周期**：ref 形如 `e3-a7k2`，token 编码 worker 代 + 快照版本；导航 / 关 tab / debugger 分离即失效；跨代或过期一律显式 `STALE_REF`，拒绝静默错点；同代快照更替时按 `backendDOMNodeId` 身份重试一次
- **后台输入**：CDP `Input.*` 在后台 tab 会被静默丢弃；输入前开启焦点仿真（`Emulation.setFocusEmulationEnabled`），后台 tab 直接接收输入，不激活、不抢焦点；按键前有"默认动作探针"检测键路假活
- **代价**：attach 期间 Chrome 显示「正在调试」黄条；目标 tab 开 DevTools 会顶掉会话（`DEBUGGER_BUSY`），关闭后自动恢复

### 开发

```bash
npm run build:extension   # 构建（依赖 protocol 包先 build）
# chrome://extensions → 开发者模式 → 加载已解压 → packages/extension/.output/chrome-mv3
# 改动后重新构建，并在 chrome://extensions 点扩展卡片上的刷新 ↻

npm run test -w @chrome-in-harness/extension   # 纯 Node 单测，不需要 Chrome / server
```

测试在 Node 里跑（`lib/` + `tools/`），chrome.* 一律 mock；桥接测试只开环回 socket，不依赖运行中的 server 或已安装扩展。

---

## English

The MV3 extension (built with WXT): the execution end for every browser operation. It drives pages inside the managed tab group via `chrome.debugger`/CDP.

> This workspace is `private` and not published to npm. See the repo [README](../../README.en.md) for installation: not on the Chrome Web Store — load the unpacked directory in developer mode.

### Layout

- **`entrypoints/`** (WXT entrypoints)
  - `background.ts`: the MV3 service worker, which is the WS **client**. Event listeners are registered synchronously (URL-change ref invalidation; refs and buffers cleaned up on tab removal / debugger detach)
  - `confirm/`: the domain-confirmation popup — shows the pending domain when an unlisted site is touched, with allow/deny
  - `options/`: the options page — allowlist maintenance plus the "allow all domains" switch (off by default; enabling requires an in-page risk confirmation)
- **`lib/`** (core logic, unit-testable; most modules have zero chrome.* dependencies)
  - Transport: `connection` (WS connect/reconnect/message loop), `cdp` (debugger session attach management), `cdp-commands` (high-level CDP wrappers: AX tree, input dispatch, focus emulation, Monaco read/write, probes)
  - Snapshot & refs: `ax-types` / `ax-snapshot` (AX tree → Playwright ariaSnapshot-style text), `ref-store` (tab → snapshot → ref mapping and history), `snapshot-version` / `worker-era` (version floor and era tokens), `ref-suggest` (similar-ref suggestions), `weak-interactive` (weak-interactive candidate scan for cursor:pointer elements)
  - Input: `keymap` (key name → CDP params), `verbatim` (indentation-preserving line-by-line insertion planning)
  - Security: `site-filter` (pure allowlist matching), `whitelist` (storage persistence), `domain-confirmation` / `domain-access` (runtime confirmation and the all-domains switch), `script-guard` (evaluate_script blacklist), `permission-grant`
  - Capture: `console-buffer` / `network-buffer` (bounded in-memory buffers while attached)
  - Misc: `tab-group` (the single source of truth for the managed-group boundary), `serialize`
- **`tools/`**: tool implementations and the registry. `registry.ts` is the only registration/invoke path (toggles the ⏳/✅/❌ group-state prefix; special-cases `ping`); `access.ts` is the **authorization orchestrator** — managed-group check first, then domain-allowlist check; only after both pass may anything touch `chrome.debugger`; `ref-recovery.ts` retries stale refs by element identity; `batch.ts` implements `run_actions`

### Key mechanisms

- **Two gates, strict order**: ① the tab must be inside the "Chrome in Harness" managed group (dragging a tab out revokes access instantly); ② the tab URL must match the domain allowlist (unlisted domains trigger a confirmation window; an empty allowlist rejects everything). Only after both gates does the debugger attach
- **Ref lifecycle**: refs look like `e3-a7k2`, the token encoding worker era + snapshot version; navigation / tab close / debugger detach invalidates them; cross-era or expired refs fail with an explicit `STALE_REF` — silent mis-targeting is never allowed; a same-era snapshot supersede retries once by `backendDOMNodeId` identity
- **Background input**: CDP `Input.*` is silently dropped on background tabs; before input we enable focus emulation (`Emulation.setFocusEmulationEnabled`) so background tabs receive input without activation or focus stealing; key presses are preceded by a default-action probe that detects a dead key pipeline
- **Cost**: Chrome shows the "being debugged" banner while attached; opening DevTools on a controlled tab displaces the session (`DEBUGGER_BUSY`) and it recovers once DevTools closes

### Development

```bash
npm run build:extension   # build (requires the protocol package to be built first)
# chrome://extensions → developer mode → Load unpacked → packages/extension/.output/chrome-mv3
# After changes, rebuild and hit the reload ↻ icon on the extension card

npm run test -w @chrome-in-harness/extension   # pure Node tests; no Chrome / server needed
```

Tests run in Node (`lib/` + `tools/`) with chrome.* fully mocked; bridge tests open loopback sockets only and need neither a running server nor an installed extension.
