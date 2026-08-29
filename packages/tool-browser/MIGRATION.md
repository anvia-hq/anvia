# `@anvia/browser` migration notes

## Selected-tab tools to explicit tabs

Existing tools remain source compatible and connections still default to serial scheduling. Calls that
omit `tabId` continue using the selected tab.

To opt into independent-tab concurrency:

```ts
const connection = await browser.connect({
  scheduling: { mode: "per-tab", maxConcurrentTabs: 8 },
});

const [{ id: first }, { id: second }] = await connection.listTabs();

await Promise.all([
  snapshot.call({ tabId: first }),
  navigate.call({ tabId: second, url: "https://example.com" }),
]);
```

Add `tabId` to `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_press_key`, and `browser_screenshot`. `browser_open_tab` returns the new stable ID. Selection is
still useful for human-oriented or legacy serial workflows, but should not be shared mutable targeting
state for concurrent agents. IDs are scoped to one connection; call `browser_list_tabs` after reconnect.

A browser handle now allows one active or pending automation connection. Share that connection between
agents that use the same browser, and disconnect it before reconnecting. This is required so one
resource scheduler and navigation policy arbitrate the shared Chromium context deterministically.

## All-or-nothing readiness to capabilities

`waitUntilReady({ timeoutMs })` still waits for all runtime, browser, automation, and desktop
capabilities. Consumers that do not require every capability should migrate to:

```ts
await browser.waitForCapabilities({
  capabilities: ["desktop"],
  timeoutMs: 10_000,
  abortSignal,
});

const { capabilities } = browser.readiness();
```

Handle `BrowserError.capability` and preserve healthy capabilities when another is degraded.

## Cancellation and errors

Connection cancellation now terminates and joins an isolated Playwright worker. Cancelling an active
page tool closes that tab because Playwright page actions do not accept `AbortSignal`; obtain a fresh tab
ID before retrying. If page cleanup cannot finish, the entire connection closes and must be recreated.

`destroy({ timeoutMs, abortSignal })` starts an irreversible terminal transition. If Docker cleanup
cannot be cancelled, the caller now stops waiting at its own deadline while the handle remains
`destroying` and retains ownership of the shared cleanup. A later `destroy()` call joins that operation;
control cannot become active again while cleanup finishes.

Prefer `error.retryable` and `error.recovery` over a closed switch on `error.code`. Legacy
`human_controlled` remains active for an acquired lease; pending acquisition now uses
`human_control_conflict`. Legacy `not_ready` remains available, while bounded connection and readiness
operations use the more specific `connection_timeout` and `readiness_timeout` codes.

`BrowserControlSnapshot` now includes required `state`, `availability`, `activeAgentActions`, and
`humanPending` fields in addition to the existing mode and optional lease metadata. Consumers that
provide a structural browser-control test double should add those fields; consumers that only read the
snapshot remain source compatible.
