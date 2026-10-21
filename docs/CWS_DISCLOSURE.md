# Chrome Web Store — Permission Disclosure

_For submission to the Chrome Web Store review._

## Justification for the `debugger` permission

Chrome in Harness uses `chrome.debugger` (CDP) for one purpose: **driving targeted tabs
in the managed workspace**, with sessions reused between tool calls. It is the mechanism
that powers:

- `snapshot` — reading the accessibility tree (`Accessibility.getFullAXTree`) plus a
  read-only DOM pass that finds clickable custom controls (`DOM.getDocument`, `Runtime.evaluate`)
- `click` / `click_at` / `hover` / `type` / `scroll` — dispatching trusted input events (`Input.*`);
  `click_at` first reads which element sits under the point, read-only
- `scroll_to` — scrolling one element into the center of the viewport
- `probe` / `get_html` — read-only inspection of one element: existence, visibility, position,
  text, a fixed allowlist of attributes, or its outerHTML (truncated to a bounded size)
- `screenshot` — capturing the viewport (`Page.captureScreenshot`), downscaled locally to
  CSS pixels
- `navigate` / `reload` — loading a URL or reloading the current page (`Page.navigate`,
  `Page.reload`, optionally bypassing the HTTP cache)
- `read_console` / `read_network` / `wait_for_response` — capturing console output and network
  **metadata** (method, URL, status, MIME type, duration, failure reason); response bodies and
  request/response headers are never read
- `evaluate_script` — executing a **restricted** script in the page context (run with a user
  gesture so page handlers that need user activation work)
- `wait` — polling for a condition in the page, or for network quiet
- `type mode="set"` — writing the Monaco editor buffer via its page-exposed API

`reload_extension` (unpacked development installs only) reloads the extension itself via
`chrome.runtime.reload()`; it does not use CDP and is refused for store installs.

CDP is the only way to synthesize real (isTrusted) input events and read the
accessibility tree from a service worker, which is what makes this tool work as a
general-purpose browser agent harness.

### Limits on debugger usage

- The debugger session is **only ever attached to a tab the user has explicitly placed
  into the "Chrome in Harness" group** (the tool's managed workspace), or created via
  `tab_new`. `takeover_tab`, which the agent may call only when the user asks, moves an
  open tab into that group without activating, focusing, navigating it or moving it to
  another window, and it refuses tabs that belong to the user's own tab groups.
- Attachment begins when a tool needs CDP and is reused for subsequent calls. Console
  and network metadata are collected continuously while attached, into bounded
  in-memory buffers, even between calls. Closing the tab, cancelling debugging, or
  debugger detachment clears its buffers and refs.
- A visible "is being debugged" banner appears in Chrome while a session is attached.
- By default domains must be allowlisted; an empty allowlist rejects all sites.
  Users may explicitly enable all-domains mode on the options page after confirming
  the risks. This permits all HTTP/HTTPS sites, but preserves managed-tab checks and
  rejects privileged/non-web URLs. The setting persists locally and is reversible.

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
network response bodies and headers are never captured; `data:` URLs are not recorded. Tool results are sent to the MCP client,
which may forward them to a remote AI provider. The extension and bridge contain no
telemetry that sends data to the author.

## Single purpose

The extension exists solely to let a **local** MCP client drive the user's own browser.
It collects console/network metadata while attached and modifies pages in response
to tool calls (including input probes and editor layout recovery). It has no
advertising or analytics. The project prioritizes convenience and is strongly
recommended for test environments with dedicated profiles and accounts.
