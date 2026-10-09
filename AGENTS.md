# Repository guidance

## Commands and verification

- Use npm workspaces and the root `package-lock.json`; use Node 22 to match CI. Install with `npm ci` from the root.
- CI order is `npm run lint` → `npm test` → `npm run build` (`.github/workflows/ci.yml`). There is no root typecheck or formatter script; formatting is handled by `npm run lint:fix` using `@ddyscn/lint-config`.
- Cross-package protocol imports resolve to `packages/protocol/dist`, not source. Run `npm run build -w @chrome-in-harness/protocol` before focused tests/builds in consumers, and rebuild it after schema changes.
- `npm run build` builds protocol → server → extension → launcher. `npm test` also builds protocol and the extension before their consumers' tests; it is not a test-only command.
- Focused tests use workspace-relative paths: `npm run test -w @chrome-in-harness/server -- src/ws-bridge.test.ts`. Add `-t "test name"` to select a test; other workspaces use the same pattern. Extension tests live under `lib/` and `tools/`, not `src/`.
- Extension tests run in Node, not Chrome. The bridge suite opens loopback sockets on ephemeral ports; it does not require a running server or installed extension.
- Extension `build` runs WXT, with no explicit `tsc` check. For extension typechecking, build first (`npm run build:extension`) to generate `.wxt/tsconfig.json`, then run `npm exec -w @chrome-in-harness/extension -- tsc --noEmit`. Do not edit `.wxt/`, `.output/`, or package `dist/` artifacts.

## Wiring and change boundaries

- Execution flow: `packages/server/src/index.ts` → stateless HTTP MCP at `/mcp` → `src/tools/index.ts` → `WsBridge` → extension `lib/connection.ts` → `tools/index.ts` dispatch. The MV3 service worker is the WebSocket **client**; browser execution uses `chrome.debugger`/CDP, not Playwright.
- Tool contracts belong in `packages/protocol/src/tools.ts` (exported by `src/index.ts`). A new/changed tool must stay aligned across protocol schemas, server `src/tools/defs-*.ts` MCP definitions, and extension `tools/` handlers plus `tools/index.ts` registration. Server definitions use schema `.shape`; extension handlers validate the same schema.
- Server/protocol/launcher use NodeNext ESM: relative imports in their TypeScript source use `.js` suffixes. Extension uses WXT's generated Bundler config and extensionless imports; it does not extend `tsconfig.base.json`.
- Register service-worker event listeners synchronously in `packages/extension/entrypoints/background.ts`. Preserve URL-change, tab-removal, and debugger-detach cleanup of refs and collectors.
- Browser access checks live in `packages/extension/tools/access.ts`, not the CDP transport. Check managed-tab membership and domain allowlist **before** debugger access; omitted `tabId` selects a managed tab, never the user's arbitrary active tab.
- Refs encode worker era and snapshot version. Preserve explicit `STALE_REF`/`NO_SNAPSHOT` failures across restarts and invalidation; same-worker recovery must identify the element rather than reuse its numeric ref blindly (`tools/ref-recovery.ts`).

## Local runtime gotchas

- `npm run dev:server` builds protocol and watches server source; `npm run build:extension` builds protocol and the extension. Load `packages/extension/.output/chrome-mv3` as an unpacked extension in Chrome and reload it after rebuilding.
- Defaults are WS `127.0.0.1:8765` and MCP `http://127.0.0.1:12306/mcp`. Server accepts `WS_PORT`/`HTTP_PORT`, but the extension WS URL, manifest host permission, and launcher ports are fixed; changing server env alone does not reconfigure the whole system.
- Use `npm run dev:server` for code iteration. Launcher `start` writes `~/.config/opencode/opencode.json` and resolves the built server entrypoint; it is not a source watcher. It preserves an existing same-name MCP entry rather than updating its URL.
- MCP clients cache tool schemas at session startup: restart the client session after changing tool parameters/registration. Extension reloads invalidate old refs; take a new snapshot. Opening DevTools on a controlled tab can displace the extension debugger (`DEBUGGER_BUSY`).
- Keep WS extension-Origin checks, MCP loopback/DNS-rebinding checks, and extension access gates intact. `CIC_EXTENSION_ID` optionally pins the permitted extension. Permission/privacy context is in `docs/CWS_DISCLOSURE.md` and `docs/PRIVACY.md`.

## Packaging

- `npm run pack` builds three npm tarballs (protocol/server/launcher) and an extension zip into `dist-release/`; the extension workspace is private. `dist-release/` is not currently gitignored, so review generated files before staging.
- Publishing is triggered by `v*` tags; `.github/workflows/publish.yml` checks the tag against the **root** package version and publishes protocol → server → launcher. Extension manifest version comes from its own `package.json` via WXT; verify workspace versions and internal dependency ranges when preparing a release.
