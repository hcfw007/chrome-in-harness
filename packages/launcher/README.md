# @chrome-in-harness/launcher

[中文](#中文) | [English](#english)

`chrome-in-harness` CLI：一条命令完成「启动本地 server + 写 MCP 客户端配置」，并提供可选的常驻服务注册。

> npm 包名是 `@chrome-in-harness/launcher`，bin 名是 `chrome-in-harness`，因此用法是 `npx @chrome-in-harness/launcher <command>`。

## 中文

### 命令

| 命令 | 作用 |
| --- | --- |
| `start` | 前台启动本地 server（Ctrl-C 退出）；已运行则复用；同时向 OpenCode 全局配置写入 MCP 条目 |
| `doctor` | 环境自检：server 是否运行、扩展是否连通（真发一次 `ping`）、检测常见 MCP 客户端配置文件 |
| `service install` | 注册常驻服务：macOS launchd / Linux systemd --user（登录自启 + 崩溃自动拉起） |
| `service status` | 查看服务安装状态与 server 运行状态 |
| `service uninstall` | 停止并移除常驻服务 |
| （无参数） | 帮助信息 |

### 实现要点

- **server 入口解析**：`import.meta.resolve('@chrome-in-harness/server')` 经 npm 依赖解析拿到入口文件，不硬编码路径
- **MCP 配置写入**（`writeOpencodeConfig`）：
  - 已有同名 `chrome-in-harness` 条目 → 原样保留（逐字节不动）
  - 配置文件不存在 → 创建配置目录并写入（文件权限 0600）
  - 配置文件非法（坏 JSON / 非对象 / `mcp` 段非对象）→ **报错退出，不覆盖原文件**
- **常驻服务**（`src/service.ts`，文件生成是纯函数、系统命令可注入，全程单测覆盖）：
  - macOS：`~/Library/LaunchAgents/com.chrome-in-harness.server.plist`（`RunAtLoad` + `KeepAlive`），日志 `~/Library/Logs/chrome-in-harness-server.log`
  - Linux：`~/.config/systemd/user/chrome-in-harness.service`（`Restart=always`），日志走 journalctl
  - 已安装时再次 `install` 拒绝覆盖；`launchctl load` 失败会回滚已写的 plist，不留半安装状态
  - Windows 不支持，明确报错并建议 `start` + 进程守护
- **CLI 入口拆分**：执行逻辑在 `src/cli.ts`（可被测试 import 且不自动执行），`src/bin.ts` 只做入口引导——通过 symlink 安装、路径含空格也能正确判定入口

### 与其他包的关系

launcher 只负责生命周期与配置：server 进程来自 `@chrome-in-harness/server`，浏览器操作全部在扩展内完成。launcher 不是源码 watcher，迭代开发请用仓库根的 `npm run dev:server`。

---

## English

The `chrome-in-harness` CLI: one command to start the local server and register the MCP client config, plus an opt-in persistent-service installer.

> The npm package is `@chrome-in-harness/launcher` while the bin is `chrome-in-harness`, so usage is `npx @chrome-in-harness/launcher <command>`.

### Commands

| Command | What it does |
| --- | --- |
| `start` | Start the local server in the foreground (Ctrl-C to stop); reuses an already-running server; also writes the MCP entry into the OpenCode global config |
| `doctor` | Environment check: is the server running, is the extension connected (performs a real `ping`), and detects common MCP client config files |
| `service install` | Install a persistent user service: launchd on macOS / systemd --user on Linux (start at login + auto-restart on crash) |
| `service status` | Show service installation and server running state |
| `service uninstall` | Stop and remove the persistent service |
| (no args) | Help |

### Implementation notes

- **Server entry resolution**: `import.meta.resolve('@chrome-in-harness/server')` resolves the entry via npm dependency resolution — no hardcoded paths
- **MCP config write** (`writeOpencodeConfig`):
  - An existing `chrome-in-harness` entry is preserved byte for byte
  - Missing config → the directory is created and the file written (mode 0600)
  - Invalid config (broken JSON / non-object / non-object `mcp` section) → **errors out without touching the original file**
- **Persistent service** (`src/service.ts`; file generation is a pure function and system commands are injectable, fully unit-tested):
  - macOS: `~/Library/LaunchAgents/com.chrome-in-harness.server.plist` (`RunAtLoad` + `KeepAlive`), logs at `~/Library/Logs/chrome-in-harness-server.log`
  - Linux: `~/.config/systemd/user/chrome-in-harness.service` (`Restart=always`), logs via journalctl
  - Re-running `install` while installed refuses to overwrite; a failed `launchctl load` rolls back the written plist, leaving no half-installed state
  - Windows is unsupported and fails with an explicit message suggesting `start` plus a process supervisor
- **CLI entry split**: the logic lives in `src/cli.ts` (importable by tests without side effects) while `src/bin.ts` is only the bootstrap — installs via symlinks and paths containing spaces are handled correctly

### Relation to other packages

The launcher only manages lifecycle and configuration: the server process comes from `@chrome-in-harness/server`, and all browser work happens inside the extension. The launcher is not a source watcher — use `npm run dev:server` from the repo root for development.
