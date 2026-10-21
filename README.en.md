# chrome-in-harness

[![CI](https://github.com/hcfw007/chrome-in-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/hcfw007/chrome-in-harness/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@chrome-in-harness/launcher)](https://www.npmjs.com/package/@chrome-in-harness/launcher)
[![Node](https://img.shields.io/node/v/@chrome-in-harness/launcher)](https://www.npmjs.com/package/@chrome-in-harness/launcher)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**English** | [中文](README.md)

An open-source, Claude-in-Chrome-style browser MCP: through a Chrome extension, any MCP-capable AI client (OpenCode / Claude Code / …) can operate your **real Chrome profile** — reusing existing logins, cookies, and extensions, with no headless browser and no re-login.

> **Convenience first — strongly recommended for test environments only.**
> This project trades security for automation convenience: operations happen in your real browser with no isolated sandbox; clicks, typing, and submissions act directly on your logged-in accounts.
> Use a dedicated test Chrome profile, test accounts, and test data. Avoid production backends, your daily-driver browser, or pages containing sensitive information. The domain allowlist, managed tab group, and script restrictions reduce mistakes but are not a full security boundary.

## Features

- **See the page**: accessibility-tree snapshots, element text, and screenshots; elements located via versioned refs.
- **Act on the page**: navigate, click, hover, scroll, type text, press keys; coordinate-click fallback for targets refs can't hit (iframes / canvas).
- **Edit code**: indentation-preserving multi-line input, plus full-buffer writes through the page's Monaco API; key-pipeline health checks and collapsed-editor recovery.
- **Manage tabs**: create, switch, and close tabs, or explicitly take over an existing tab; operations are confined to the "Chrome in Harness" managed group.
- **Tab sessions**: `ensure_tab` hands out a reusable tab handle — each agent keeps its own tab, and a closed tab is recreated automatically, so tabs don't multiply.
- **Batch execution**: `run_actions` runs a sequence of tools in one call (e.g. typing key by key), cutting MCP round trips.
- **Wait & debug**: wait for text / selector / URL / editor readiness, read console messages and network request metadata, run restricted page JS.
- **Stay out of your way**: new tabs always open in the background; input reaches background tabs via focus emulation; when a human is needed (login, captcha), the agent asks you to switch tabs yourself.

## Architecture

```text
AI / MCP client (OpenCode, Claude Code, …)
        │ Streamable HTTP: tool calls / results
        ▼
Local Node.js server · http://127.0.0.1:12306/mcp
        │ WebSocket: request forwarding / response correlation
        │ ws://127.0.0.1:8765 (extension connects out)
        ▼
Chrome extension · MV3 service worker / WXT
        │ chrome.debugger / Chrome DevTools Protocol
        ▼
Managed tabs inside your real Chrome profile
```

Four packages: `@chrome-in-harness/protocol` (shared WS protocol definitions, zod schemas, and type guards), `@chrome-in-harness/server` (WS bridge + MCP endpoint), `@chrome-in-harness/extension` (MV3 extension), `@chrome-in-harness/launcher` (the `chrome-in-harness` CLI). Each has its own README with deeper architecture notes:

| Package | README |
| --- | --- |
| protocol | [packages/protocol/README.md](packages/protocol/README.md) |
| server | [packages/server/README.md](packages/server/README.md) |
| extension | [packages/extension/README.md](packages/extension/README.md) |
| launcher | [packages/launcher/README.md](packages/launcher/README.md) |

- The extension's service worker is the WS **client** connecting out to `ws://127.0.0.1:8765` (no extra Chrome ports; the connection is extension-initiated)
- The server exposes MCP at `http://127.0.0.1:12306/mcp` (stateless Streamable HTTP); tool calls are forwarded over WS to the extension and correlated by message `id`, with a 30s timeout
- WS protocol v1: request `{ v: 1, id, tool, params }`, response `{ v: 1, id, ok, result | error }`; definitions and guards live in `@chrome-in-harness/protocol`, shared by both ends
- One call's path: client picks a tool → server forwards over WS → extension validates params and checks the tab / domain boundary → CDP executes → the result travels back through the server. The extension performs all browser work; the server never launches a browser.
- The extension↔server bridge stays on your machine; snapshots, screenshots, and logs returned to the MCP client may then be sent to a remote model depending on your client's configuration.

## Security trade-offs & boundaries

This is a convenience tool for development, debugging, and testing — not a production security boundary. Reusing real logins means the agent can act with your current account privileges, and page content or model judgment can mislead subsequent calls. There is no per-click/typing/submission human approval, and domain authorization is not per-action authorization.

Existing guardrails:

- **WS handshake verifies Origin**: only `chrome-extension://` origins are accepted. The browser forces the Origin header and pages cannot forge it, so a malicious page cannot connect to `127.0.0.1:8765`, displace the real extension, and hijack tool calls. Setting `CIC_EXTENSION_ID` additionally pins one extension ID.
- **DNS-rebinding protection on the MCP endpoint**: `Host` must be `127.0.0.1:12306` / `localhost:12306`; when `Origin` is present it is validated too (browser pages rejected, non-browser MCP clients pass).
- **Tab & domain boundary**: before any browser execution the managed group and domain allowlist are checked; unknown domains pop a confirmation window by default. `add_allowlist_domain` writes the allowlist directly — its "only when the user explicitly asks" rule relies on the client/agent honoring tool descriptions.
- **Restricted scripts**: `evaluate_script` uses a blacklist plus expression-shape checks to block common network, navigation, and dynamic-evaluation APIs; this is a guardrail against misuse, not a JS sandbox, and does not guarantee side-effect-free expressions.
- Permissions are minimal: `alarms` (SW keepalive), `tabs` + `tabGroups` (tab management / managed-group boundary / URL-change ref invalidation), `storage` (allowlist persistence), `debugger` (CDP sessions; the "being debugged" banner appears only while attached), `permissions` (`request_permission` prompts); host permission is loopback-only `127.0.0.1:8765`, with target sites granted at runtime via `optional_host_permissions`.

These limits do not defend against local malicious processes: the MCP endpoint has no client authentication and a local process can forge an Origin to reach the WS. Do not expose the local endpoints to public networks. **Connect to test environments only, with an isolated test profile and accounts.** See [CWS_DISCLOSURE](docs/CWS_DISCLOSURE.md) and [PRIVACY](docs/PRIVACY.md) for permission and data-handling details.

## Tools & behavior details

**Tool set** (30): `ping`, `reload_extension`, `navigate`, `reload`, `snapshot`, `click`, `click_at`, `hover`, `type`, `press_key`, `get_text`, `probe`, `get_html`, `wait_for_response`, `scroll`, `scroll_to`, `screenshot`, `tab_list`, `tab_new`, `ensure_tab`, `tab_select`, `tab_close`, `takeover_tab`, `run_actions`, `read_console`, `read_network`, `wait`, `add_allowlist_domain`, `evaluate_script`, `request_permission`.

- **read_console / read_network**: CDP-captured console output and network request metadata, including durations and detailed failure reasons (response bodies and headers are never captured; `data:` URLs are skipped). Buffers accumulate from a tab's first attach.
- **wait_for_response**: wait until a request whose URL contains a substring (optionally with status / method) completes — metadata only; a 2s default lookback makes click-then-wait race-free.
- **probe / get_html**: read-only element inspection by ref / selector / visible text (exactly one) — probe returns existence, match count, visibility, rect, text and allowlisted attributes; get_html returns outerHTML (4000 chars by default, max 20000).
- **wait**: wait for text / CSS selector / URL substring (in-page promise polling, default 8s, max 30s) or `networkIdle:true` (no new request for 500ms); at most one condition, and passing only `timeoutMs` is a plain delay; timeouts return `{matched:false}` instead of erroring.
- **reload_extension**: development only — reloads the unpacked extension from disk (same as ↻ on `chrome://extensions`) and waits for it to reconnect, so an agent can rebuild and verify extension code without manual clicks. Store installs are refused. Tool schemas are unaffected: parameter changes still need a server + client session restart.
- **scroll_to**: scroll an element to the viewport center by ref / CSS selector / visible text (exactly one); returns its post-scroll viewport rect and `inViewport`.
- **reload**: reload the current page with navigate's wait strategies; `hard:true` bypasses the HTTP cache (check a deploy without cache-busting query params that change the route); all refs are invalidated.
- **screenshot**: scaled by 1/dpr so image pixels equal viewport CSS pixels — measured coordinates go straight into `click_at`; reports `width/height/dpr` as text.
- **add_allowlist_domain**: extends the allowlist directly (no confirmation window). Usually unnecessary — unknown domains pop the confirmation window automatically.
- **evaluate_script**: restricted `Runtime.evaluate` in the page context. The blacklist rejects network access (fetch/XHR/WebSocket/sendBeacon), eval/Function, navigation (location/window.open), document.write, debugger, and `chrome.*`; `awaitPromise:true` requires an async IIFE; oversized JSON results are truncated; runs with a user gesture, so a page `window.open` triggered by `element.click()` inside the script is not popup-blocked.
- **request_permission**: fires the native `chrome.permissions.request` prompt for a domain and writes the grant into the storage allowlist. Call only when the user explicitly asks.
- **takeover_tab**: brings an already-open user tab into the managed group (`tab_list` marks it `[managed:<groupId>]`); call only when the user explicitly asks to work in that tab; the URL must already be allowlisted.
- **ensure_tab / run_actions**: see [Tab conventions](#tab-conventions) and [Batch execution](#batch-execution) below.

- **snapshot**: `chrome.debugger` + CDP `Accessibility.getFullAXTree`, rendered as Playwright ariaSnapshot-style indented text with `[ref=eN-<token>]` on interactive elements; prefer ref-based interaction to avoid selector drift. Coordinate clicks and focused-element input can skip refs.
- **Ref lifecycle**: refs bind to a tab's latest snapshot, format `e<N>-<token>` (token = worker era + snapshot version); navigation / tab close / debugger detach invalidates them; cross-era or stale refs fail with an explicit `STALE_REF` (no silent mis-targeting); same-era snapshot supersede retries once by element identity; after the SW is killed, `NO_SNAPSHOT` guides a re-snapshot.
- **click snapshot**: `click({ref, snapshot: true})` waits two animation frames after the click (300ms cap on background tabs) and returns a fresh snapshot — for pages that re-render on click and invalidate every ref, saving a `snapshot` round trip; content rendered after an async fetch still needs `wait` first. If the click lands but the snapshot fails, the failure is reported without erroring, so the click is not retried by mistake.
- **click_at**: coordinate-click fallback when refs can't hit (iframe/canvas/icon-only containers); viewport CSS pixels; out-of-bounds coordinates error explicitly; hit-tests before clicking and reports the element under the point plus its nearest interactive ancestor (tells mis-aimed / covered clicks from inert handlers).
- **press_key**: single keys / combos (`ctrl`/`alt`/`shift`/`meta` + key name, F1–F24 supported), optionally focusing a ref first; before dispatch, a default-action probe types into an offscreen input to verify keys actually insert characters (listener probes can't detect "event delivered but default action dropped" — the typical death after resize/blur); a dead pipeline self-heals and otherwise reports `KEY_PIPELINE_DEAD`.
- **get_text**: prefers the AX value (the only reliable full read on virtualized editors) with innerText fallback; 8KB cap.
- **type**: `mode="insert"` (default) / `mode="verbatim"` (line-by-line insertText preserving indentation for Monaco-like editors, no trimming) / `mode="set"` (atomic full-buffer `setValue` via the Monaco API — bypasses keyboard/focus/IME entirely, immune to blur, dead key pipelines, and collapsed editors; `ref` optional, auto-targets the single editor); if focus isn't on an editable element it reports `INPUT_NOT_LANDED` instead of silently failing; returns an `{line, col}` insertion point for self-checks.
- **wait editorRendered**: Monaco is "rendered" when height > 40px and width > 200px with a non-empty view-line — collapsed 5×5 slivers after resize no longer pass; a collapsed editor is rescued by forcing `layout()` with explicit parent dimensions.
- **Input paths**: regular clicks and typing dispatch browser events via CDP `Input.*`; `type mode="set"` calls the Monaco API directly and does not simulate keystrokes. Sites are not guaranteed to treat automation as human.
- **Domain allowlist + runtime confirmation**: persisted in `chrome.storage.local`, checked by the extension before attach; an empty list rejects everything; rule `example.com` matches itself and any-depth subdomains. Touching an unlisted domain **pops a confirmation window** (showing the domain and source URL); the tool returns `DOMAIN_CONFIRMATION_REQUIRED` (non-blocking) — click Allow and retry, no config editing needed.
- **Managed-group reuse**: `tab_new` / `takeover_tab` join the window's existing "Chrome in Harness" group (state prefixes `⏳/✅/❌` in the title are matched as the same group), avoiding duplicate groups.
- **Accepted cost**: the "being debugged" banner shows while attached; opening DevTools on a controlled tab displaces the session (`DEBUGGER_BUSY`) and it recovers when DevTools closes.
- **Background operation (automatic, no focus stealing)**: CDP `Input.*` is silently dropped on background tabs; input tools enable `Emulation.setFocusEmulationEnabled` first (same as Playwright / Claude-in-Chrome) so background tabs receive input **without activating the tab or interrupting you**; falls back to activation when emulation is unavailable; minimized windows are restored and focused, with `WINDOW_NOT_INTERACTIVE` on failure.

## Installation & running

Four steps overall: **① start the local server → ② install the Chrome extension → ③ register your MCP client → ④ verify**. The extension is **not on the Chrome Web Store** — step ② is a manual load, so follow it carefully.

### Prerequisites

- Node.js ≥ 20 (22 recommended)
- A Chrome/Chromium browser
- Strongly recommended: a **dedicated test Chrome profile** (Chrome → avatar → add a new user), isolated from daily browsing

### Step ①: start the local server

```bash
npx @chrome-in-harness/launcher start
```

This single command:

- Detects an already-running server (and reuses it)
- Starts the local server (WS `127.0.0.1:8765` ↔ MCP `http://127.0.0.1:12306/mcp`)
- Writes the `chrome-in-harness` remote MCP entry into `~/.config/opencode/opencode.json` (existing same-name entries are preserved; an unreadable or invalid config file aborts without overwriting)

`start` runs in the **foreground** and stops when the terminal closes. For an always-on setup see [Persistent service](#persistent-service-optional).

### Step ②: install the Chrome extension (manual load)

> The extension is not on the Chrome Web Store; install it via developer mode + "Load unpacked". Pick one of the two sources:

**Option A: download the zip from GitHub Releases (recommended)**

1. Download `chrome-in-harness-extension.zip` from the [Releases page](https://github.com/hcfw007/chrome-in-harness/releases)
2. **Extract it into a permanent directory** (e.g. `~/chrome-in-harness-extension`). The directory must not be deleted or moved — Chrome loads the extension *from* that directory, so if it disappears the extension breaks.
3. Open `chrome://extensions`
4. Turn on **Developer mode** (top right)
5. Click **Load unpacked** (top left) and select the extracted directory (the folder itself, not the zip)
6. **Chrome in Harness** appears in the list — done

**Option B: build from source (developers)**

```bash
git clone https://github.com/hcfw007/chrome-in-harness.git
cd chrome-in-harness
npm ci && npm run build:extension
```

Then follow steps 3–5 of Option A, selecting `packages/extension/.output/chrome-mv3` as the directory.

**Upgrading the extension**

- Option A: download the new zip → extract **over the same directory** → back on `chrome://extensions`, click the **reload ↻** icon on the Chrome in Harness card
- Option B: `git pull && npm ci && npm run build:extension` → same reload click

**First-use notes**

- The extension connects to the local server (`ws://127.0.0.1:8765`) automatically — no configuration; if the server starts later, the extension reconnects on its own
- The extension's options page manages the domain allowlist and access mode
- The first time an unlisted domain is touched, a confirmation window pops up; clicking Allow adds it to the allowlist

### Step ③: register your MCP client

- **OpenCode**: `start` in step ① already wrote the global config — just reopen the client session
- **Other MCP clients** (Claude Code, etc.): register the remote endpoint manually

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

### Step ④: verify the whole chain

```bash
npx @chrome-in-harness/launcher doctor
```

You should see:

```text
[✓] server 已在运行 (http://127.0.0.1:12306/mcp)
[✓] 扩展已连接（ping 通过）
```

Or simply ask the model in your MCP client to call `ping` — it should return the extension version and userAgent.

> **After upgrading the MCP server you must restart the client session**: clients like OpenCode / Claude Code register tool schemas at session start and don't hot-reload. Old sessions keep validating against old schemas and reject new params/tools — restarting the session fixes it. Same for refs: snapshot refs carry a token suffix (like `e3-a7k2`) and old refs across sessions/worker restarts are explicitly rejected (`STALE_REF`) — just re-snapshot.

### Persistent service (optional)

`start` is a foreground process that ends when the terminal closes or the machine reboots. To keep it always on, register a user-level service (start at login + auto-restart on crash):

```bash
npx @chrome-in-harness/launcher service install    # macOS launchd / Linux systemd --user
npx @chrome-in-harness/launcher service status     # check installation and running state
npx @chrome-in-harness/launcher service uninstall  # stop and remove
```

- macOS: writes `~/Library/LaunchAgents/com.chrome-in-harness.server.plist` (`RunAtLoad` + `KeepAlive`); logs at `~/Library/Logs/chrome-in-harness-server.log`
- Linux: writes `~/.config/systemd/user/chrome-in-harness.service` (`Restart=always`); logs via `journalctl --user -u chrome-in-harness.service`
- Windows is unsupported — keep a terminal open with `start` (or use `pm2` and the like)
- Re-running `install` while installed refuses to overwrite (uninstall first); the extension reconnects automatically after server restarts

### Tab conventions

Agents should prefer `ensure_tab`, save the returned `{tabId, url, reused}`, and pass that `tabId` explicitly on every subsequent call.
Calling `ensure_tab({tabId, url?})` again reuses the tab if it still exists and is managed — no navigation, no focus change; if it was closed, a background tab is recreated and a new id returned.
The `url` is only used at creation; to change pages on a reused tab call `navigate`. Without a `url`, the new tab opens at `about:blank`. A tab the user dragged out of the managed group is an error, never auto-replaced.
Each agent keeps its own tab id; use `tab_new` only when multiple tabs are explicitly needed — the server provides no agent identity or locking.

New tabs (`tab_new`) always open in the background without stealing focus. When a human is needed (login, captcha, review) the agent should ask the user to switch tabs; `tab_select` is called only when the user explicitly asks.

### Batch execution

Repetitive sequences (e.g. typing with per-character `press_key`) can use `run_actions` in **one call**:
pass `actions: [{tool, params}, ...]`; a top-level `tabId` is injected into steps that omit their own. Steps run in order and later steps observe earlier changes;
execution stops at the first failure unless `continueOnError: true` (which continues and records per-step errors). Max 50 steps per call; nesting `run_actions` is rejected, and `screenshot` is not allowed inside a batch.

### Domain access mode

By default access is restricted to the allowlist. The extension options page offers an "allow all domains" switch — off by default, with an in-page risk confirmation before enabling.
When on, all HTTP/HTTPS sites are allowed inside the managed group with no per-domain confirmations; Chrome internal pages, extension pages, and local files remain off-limits.
The setting persists in the extension's local storage; the original allowlist is kept and takes effect again the moment the switch is turned off.
This mode uses real logins and can read sensitive content or submit real data — enable it only in a dedicated test browser profile with test accounts.

## Distribution

- **npm**: `@chrome-in-harness/server` (server, includes the `chrome-in-harness-server` bin), `@chrome-in-harness/launcher` (the `chrome-in-harness` CLI), `@chrome-in-harness/protocol` (protocol types)
- **GitHub Releases**: `v*` tags automatically publish to npm and package the extension zip (.github/workflows/publish.yml); the extension installs from the `chrome-in-harness-extension.zip` asset
- **Chrome Web Store**: not published; permission and data-handling notes live in [docs/CWS_DISCLOSURE.md](docs/CWS_DISCLOSURE.md) and [docs/PRIVACY.md](docs/PRIVACY.md)

## Development

> CI: push/PR runs lint → test → extension typecheck → build (.github/workflows/ci.yml).

```bash
# 1. Use Node 22 to match CI; install and verify from the repo root
npm ci
npm run lint           # @ddyscn/lint-config (ESLint flat config)
npm test               # builds protocol / extension, runs all four packages' Vitest
npm run typecheck:extension # builds the extension and runs a standalone TS check
npm run build          # protocol → server → extension → launcher
# Extension output: packages/extension/.output/chrome-mv3
# Auto-fix formatting / lint: npm run lint:fix

# 2. Start the local server
npm run dev:server

# 3. Load the extension in Chrome: see "Step ② · Option B" above
#    After changes run npm run build:extension and hit reload in chrome://extensions

# 4. Register the MCP client: see "Step ③" above
```

Package local release artifacts (three npm tarballs + extension zip into `dist-release/`):

```bash
npm run pack
```

## Roadmap

- **Phase 4** — unrestricted execution / page-interaction enhancements: if bypassing the restricted `evaluate_script` becomes necessary, evaluate `chrome.scripting` + `world: "MAIN"` injection surfaces and CSP compatibility
