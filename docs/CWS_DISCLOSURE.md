# Chrome Web Store — Permission Disclosure

_For submission to the Chrome Web Store review._

## Justification for the `debugger` permission

Chrome in Harness uses `chrome.debugger` (CDP) for one purpose: **driving the specific
tab the user has targeted**, for the duration of a single tool call. It is the mechanism
that powers:

- `snapshot` — reading the accessibility tree (`Accessibility.getFullAXTree`)
- `click` / `hover` / `type` / `scroll` — dispatching trusted input events (`Input.*`)
- `screenshot` — capturing the viewport (`Page.captureScreenshot`)
- `read_console` / `read_network` — capturing console + network metadata
- `evaluate_script` — executing a **restricted** script in the page context
- `wait` — polling for a condition in the page

CDP is the only way to synthesize real (isTrusted) input events and read the
accessibility tree from a service worker, which is what makes this tool work as a
general-purpose browser agent harness.

### Limits on debugger usage

- The debugger session is **only ever attached to a tab the user has explicitly placed
  into the "Chrome in Harness" group** (the tool's managed workspace), or created via
  `tab_new`.
- The debugger is attached **only for the duration of a tool call** — it is not a
  persistent background monitor.
- A visible "is being debugged" banner appears in Chrome while a session is attached.
- Domains must be allowlisted before any operation; an empty allowlist rejects everything.

## Justification for `optional_host_permissions: ["*://*/*"]`

All host permissions are **optional** (requested at runtime), never mandatory. Each
grant is triggered only by an explicit user request (via the `request_permission` tool)
and is confirmed through Chrome's native permission prompt. Users can revoke any grant
at any time in `chrome://extensions`. The optional-pattern approach means the extension
holds **no** host access by default.

## Data handling

See [docs/PRIVACY.md](../docs/PRIVACY.md): all data stays on the user's machine; network
response bodies are never captured; nothing is transmitted off-device.

## Single purpose

The extension exists solely to let a **local** MCP client drive the user's own browser.
It does not read data in the background, does not modify pages except on explicit tool
calls, and has no advertising, analytics, or third-party code.
