# Chrome in Harness — Privacy Policy

_Last updated: 2026-09-30_

## Overview

Chrome in Harness is a browser automation tool: it lets a local MCP (Model Context
Protocol) server drive your **real Chrome profile** (pages, clicks, typing) through a
Chrome extension bridge. Everything runs **locally on your machine**.

## What data is processed

- **Page content / DOM**: When you invoke tools like `snapshot`, `click`, `type`, or
  `evaluate_script`, the extension reads the accessibility tree or DOM of the tab you
  explicitly target, and executes the operations you asked for.
- **Network request metadata**: The `read_network` tool captures request **metadata**
  (method, URL, status, MIME type). **Response bodies are never captured.**
- **Console output**: The `read_console` tool captures console messages of the target tab.

## Where data goes

- **100% local.** The extension talks only to a local server on `127.0.0.1` via
  WebSocket. The local server exposes an MCP endpoint on `127.0.0.1` only.
- No data is sent to any cloud service, third party, or the extension author.
- The only outbound network traffic is what *you* ask the browser to do through the
  tool (e.g. navigating a tab to a URL).

## What data is stored

- **Domain allowlist**: a list of domains you have approved, stored in `chrome.storage.local`
  (local to your browser, not synced).
- **Optional host permissions**: domains you grant at runtime via the browser permission
  prompt (reversible at any time in `chrome://extensions`).

## Access control

- Only tabs inside the "Chrome in Harness" tab group can be operated on.
- Only domains in your allowlist can be operated on.
- The extension does **not** run in the background for purposes other than responding
  to tool calls and keeping its local WebSocket alive.

## Permissions

- **`debugger`** (CDP): used only to drive the tab you target, for the duration of a
  tool call. See the CWS disclosure for details.
- **`tabs` / `tabGroups`**: used to identify which tabs belong to the managed group and
  to create/select/close tabs on request.
- **`storage`**: stores your domain allowlist locally.
- **`alarms`**: keeps the service worker alive for the local WebSocket bridge.
- **`permissions` / optional host permissions**: lets you grant per-domain access at
  runtime via the browser prompt.

## Contact

For privacy questions, open an issue at:
https://github.com/hcfw007/chrome-in-harness
