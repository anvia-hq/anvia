# `@anvia/browser`

Visible Chromium ownership and semantic browser tools for Anvia agents. Docker infrastructure remains
owned by `@anvia/sandbox`; this package owns the browser workload running inside that sandbox.

```ts
import { DockerBrowserClient, createBrowserTools } from "@anvia/browser";
import { Agent } from "@anvia/core/agent";
import { DockerSandboxClient } from "@anvia/sandbox";

const browserClient = new DockerBrowserClient({
  sandboxClient: new DockerSandboxClient(),
  image: "ghcr.io/anvia-hq/browser@sha256:...",
});

await browserClient.pullImage();
await using browser = await browserClient.createBrowser({
  workspace: { type: "ephemeral" },
  network: { mode: "bridge" },
  desktop: {
    protocol: "novnc",
    password: "passw0rd",
    viewport: { width: 1440, height: 900 },
  },
});

await browser.waitUntilReady({ timeoutMs: 30_000 });
await using connection = await browser.connect();

const tools = createBrowserTools({
  connection,
  tools: [
    "browser_list_tabs",
    "browser_open_tab",
    "browser_select_tab",
    "browser_close_tab",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_press_key",
    "browser_screenshot",
  ],
  navigation: { mode: "allow-all-http" },
});

const agent = new Agent({ id: "browser-agent", model, tools });
```

The client constructor performs no I/O. `pullImage()`, `createBrowser()`, readiness, and CDP
connection are separate operations. `DockerBrowser` owns the underlying sandbox. A
`PlaywrightBrowserConnection` owns only its CDP connection and never destroys the browser.

`stop()` preserves the container. `resumeBrowser({ id })` starts a fresh browser service and requires
a new readiness check and CDP connection. A named Docker volume preserves Chromium profile state even
when the browser container is destroyed and later recreated with that volume.

The browser tools use ARIA state and strict Playwright locators. They do not expose JavaScript
evaluation, raw CDP, coordinate input, shell access, hidden retries, or automatic reconnection.
Aborting an action that Playwright cannot cancel closes the CDP connection and leaves the browser
running. The selected navigation policy is installed across the connection, so top-level navigation
from links, forms, redirects, popups, and direct navigation is checked consistently. It does not block
third-party subresources; Docker bridge networking remains outside that policy.

The image runs Chromium as a non-root user with Chromium sandboxing, the pinned Playwright seccomp
profile, every Linux capability dropped except the explicit `SYS_CHROOT` capability required by the
namespace sandbox, no-new-privileges, and private shared memory. Startup fails rather than silently
switching Chromium to `--no-sandbox`. Docker bridge networking is not an SSRF boundary; use
infrastructure network policy where browsing untrusted destinations requires isolation.

The VNC protocol uses exactly eight printable ASCII password characters. noVNC is published only on a
host-loopback Docker port, raw VNC is not published, and the password is not placed in image metadata,
URLs, environment variables, or logs.

## Studio desktop and takeover

`browser.desktop` is structurally compatible with Studio without creating a package dependency:

```ts
const studio = new Studio([agent], {
  sandboxes: [
    {
      inspector: browser.inspector({ files: true, ports: true, processes: true }),
      agentIds: [agent.id],
      toolNames: tools.map((tool) => tool.name),
      views: [
        {
          id: "desktop",
          label: "Browser",
          source: browser.desktop,
          access: { mode: "local" },
          authentication: { type: "password", password },
        },
      ],
    },
  ],
});
```

Use `{ mode: "authorize", authorize }` when Studio is reachable remotely. The callback is invoked for
the viewer connection, WebSocket upgrade, and every control operation. When the registered agent uses a
matching browser tool, Studio opens its clean programmatic noVNC viewer in a resizable Playground panel;
there is no stock noVNC toolbar, splash, or password prompt. Closing the panel restores Sessions and an
**Open browser** action restores the current desktop. Studio human takeover waits for an active agent
action, blocks new browser tool actions, and expires unless the Studio viewer renews its lease. Takeover
coordinates trusted viewers; application authorization remains the security boundary.
