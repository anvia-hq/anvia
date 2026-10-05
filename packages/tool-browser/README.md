# @anvia/browser

Let agents work in a visible Chromium browser that people can inspect and take over. Share a browser across agents, give each task a tab, and bring the live desktop into Anvia Studio.

## Installation

```sh
pnpm add @anvia/browser @anvia/sandbox @anvia/core

# Build the browser image shipped with the installed package.
docker build -t anvia-browser ./node_modules/@anvia/browser/image
```

## Quick start

Requires Docker and a compatible Node.js runtime; see the [compatibility guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/tool-browser.md#playwright-and-node-compatibility). Set `BROWSER_DESKTOP_PASSWORD` to exactly eight printable ASCII characters for the desktop viewer.

```ts
import { createBrowserTools, DockerBrowserClient } from "@anvia/browser";
import { DockerSandboxClient } from "@anvia/sandbox";

const client = new DockerBrowserClient({
  sandboxClient: new DockerSandboxClient(),
  image: "anvia-browser",
});

await using browser = await client.createBrowser({
  workspace: { type: "ephemeral" },
  network: { mode: "bridge" },
  desktop: {
    protocol: "novnc",
    password: process.env.BROWSER_DESKTOP_PASSWORD!,
    viewport: { width: 1440, height: 900 },
  },
});
await browser.waitForCapabilities({
  capabilities: ["automation", "desktop"],
  timeoutMs: 30_000,
});

await using connection = await browser.connect({
  scheduling: { mode: "per-tab" },
});
const tools = createBrowserTools({
  connection,
  tools: ["browser_open_tab", "browser_snapshot", "browser_click", "browser_type"],
  navigation: { mode: "allow-all-http" },
});
// Pass tools to new Agent({ id, model, tools }).
```

## What you get

- Semantic navigation, snapshots, clicks, typing, and screenshots.
- Concurrent work across tabs with ordered actions within each tab.
- Visible desktop and exclusive human takeover.
- Separate readiness checks for browser, automation, and desktop.
- Explicit cancellation, cleanup, and recoverable lifecycle errors.

Keep the browser and connection alive while tools are in use. Navigation policies check destinations but are not a network isolation boundary; see the guide for deployment and network controls.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/tool-browser.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
