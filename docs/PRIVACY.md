# Chrome in Harness — Privacy Policy

_Last updated: 2026-10-09_

## Overview

Chrome in Harness is a browser automation tool: it lets a local MCP (Model Context
Protocol) server drive your **real Chrome profile** (pages, clicks, typing) through a
Chrome extension bridge. The extension and bridge server run **locally on your machine**.
This convenience-first tool is strongly recommended for test environments only, with
a dedicated test profile, account, and data. It is not an isolated browser sandbox.

## What data is processed

- **Page content / DOM**: When you invoke tools like `snapshot`, `click`, `type`, or
  `evaluate_script`, the extension reads the accessibility tree or DOM of the tab you
  explicitly target, and executes the operations you asked for.
- **Network request metadata**: The `read_network` tool captures request **metadata**
  (method, URL, status, MIME type). **Response bodies are never captured.**
- **Console output**: The `read_console` tool captures console messages of the target tab.
- **Screenshots**: The `screenshot` tool returns an image of the target tab's viewport.
- **Tab metadata**: `tab_list` lists titles and URLs of open tabs, including unmanaged tabs;
  browser interaction is restricted to the managed group.

## Where data goes

- **Local bridge.** The extension talks to a local server on `127.0.0.1` via
  WebSocket. The local server exposes an MCP endpoint on `127.0.0.1` only.
- The extension and bridge do not send telemetry to the extension author or a cloud
  service. Tool results are returned to your MCP client, which may send page content,
  screenshots, URLs, or logs to remote AI providers according to its own configuration
  and privacy policy.
- Target websites continue to make their normal network requests; actions requested
  through the tools use the browser's existing login state and can submit real data.

## What data is stored

- **Domain allowlist**: a list of domains you have approved, stored in `chrome.storage.local`
  (local to your browser, not synced).
- **Optional host permissions**: domains you grant at runtime via the browser permission
  prompt (reversible at any time in `chrome://extensions`).
- **Pending domain confirmation and snapshot version counters**: stored locally to
  coordinate approval and prevent stale ref reuse. Console/network buffers and ref
  mappings are held in service-worker memory and cleared on tab removal or debugger
  detachment; URL changes invalidate ref mappings.

## Access control

- Only tabs inside the "Chrome in Harness" tab group can be operated on.
- Only domains in your allowlist can be operated on.
- Debugger sessions are reused after tool calls. While a session remains attached,
  console and network metadata continue to accumulate in bounded in-memory buffers,
  even between calls; collection begins on first attachment.
- Domain approval is stored in the extension's allowlist. Revoking an optional Chrome
  host permission does not by itself remove that allowlist entry; remove it on the
  extension's options page as well. These controls are not a complete security sandbox.

## Permissions

- **`debugger`** (CDP): used to drive targeted managed tabs and collect console/network
  metadata while attached. Sessions are reused until detached (for example when the
  tab closes, the user cancels debugging, or DevTools takes over).
- **`tabs` / `tabGroups`**: used to identify which tabs belong to the managed group and
  to create/select/close tabs on request.
- **`storage`**: stores your domain allowlist locally.
- **`alarms`**: keeps the service worker alive for the local WebSocket bridge.
- **`permissions` / optional host permissions**: lets you grant per-domain access at
  runtime via the browser prompt.

## Contact

For privacy questions, open an issue at:
https://github.com/hcfw007/chrome-in-harness
