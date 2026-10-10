# Chrome Web Store — Permission Disclosure

_For submission to the Chrome Web Store review._

## Justification for the `debugger` permission

Chrome in Harness uses `chrome.debugger` (CDP) for one purpose: **driving targeted tabs
in the managed workspace**, with sessions reused between tool calls. It is the mechanism
that powers:

- `snapshot` — reading the accessibility tree (`Accessibility.getFullAXTree`)
- `click` / `hover` / `type` / `scroll` — dispatching trusted input events (`Input.*`)
- `screenshot` — capturing the viewport (`Page.captureScreenshot`)
- `read_console` / `read_network` — capturing console + network metadata
- `evaluate_script` — executing a **restricted** script in the page context
- `wait` — polling for a condition in the page
- `type mode="set"` — writing the Monaco editor buffer via its page-exposed API

CDP is the only way to synthesize real (isTrusted) input events and read the
accessibility tree from a service worker, which is what makes this tool work as a
general-purpose browser agent harness.

### Limits on debugger usage

- The debugger session is **only ever attached to a tab the user has explicitly placed
  into the "Chrome in Harness" group** (the tool's managed workspace), or created via
  `tab_new`.
- Attachment begins when a tool needs CDP and is reused for subsequent calls. Console
  and network metadata are collected continuously while attached, into bounded
  in-memory buffers, even between calls. Closing the tab, cancelling debugging, or
  debugger detachment clears its buffers and refs.
- A visible "is being debugged" banner appears in Chrome while a session is attached.
- Domains must be allowlisted before any operation; an empty allowlist rejects everything.

## Justification for `optional_host_permissions: ["*://*/*"]`

Target-site host permissions are **optional** (requested at runtime). The manifest
also includes a mandatory loopback host permission for the local WebSocket server. Each optional
grant is triggered only by an explicit user request (via the `request_permission` tool)
and is confirmed through Chrome's native permission prompt. Users can revoke any grant
at any time in `chrome://extensions`. The optional-pattern approach means the extension
holds no target-site **optional host grants** by default. The separate `debugger`
permission is powerful; the extension's stored domain allowlist is the primary
application-level gate. The custom domain confirmation window updates that allowlist
without requesting a Chrome host grant. Revoking an optional host grant does not
remove the corresponding stored allowlist entry.

## Data handling

See [docs/PRIVACY.md](../docs/PRIVACY.md): the extension-to-server bridge is local and
network response bodies are never captured. Tool results are sent to the MCP client,
which may forward them to a remote AI provider. The extension and bridge contain no
telemetry that sends data to the author.

## Single purpose

The extension exists solely to let a **local** MCP client drive the user's own browser.
It collects console/network metadata while attached and modifies pages in response
to tool calls (including input probes and editor layout recovery). It has no
advertising or analytics. The project prioritizes convenience and is strongly
recommended for test environments with dedicated profiles and accounts.
