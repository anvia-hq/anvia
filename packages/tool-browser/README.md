# `@anvia/browser`

Visible Chromium ownership and semantic browser tools for concurrent Anvia agents and human viewers.
Docker infrastructure remains owned by `@anvia/sandbox`; this package owns the browser workload,
capability readiness, isolated Playwright connection, action scheduling, and control arbitration.

```ts
import { DockerBrowserClient, createBrowserTools } from "@anvia/browser";
import { Agent } from "@anvia/core/agent";
import { DockerSandboxClient } from "@anvia/sandbox";

const browserClient = new DockerBrowserClient({
  sandboxClient: new DockerSandboxClient(),
  image: "ghcr.io/anvia-hq/browser@sha256:...",
});

await browserClient.pullImage({ timeoutMs: 120_000 });
await using browser = await browserClient.createBrowser({
  workspace: { type: "ephemeral" },
  network: { mode: "bridge" },
  desktop: {
    protocol: "novnc",
    password: "passw0rd",
    viewport: { width: 1440, height: 900 },
  },
});

await browser.waitForCapabilities({
  capabilities: ["automation", "desktop"],
  timeoutMs: 30_000,
});

await using connection = await browser.connect({
  timeoutMs: 30_000,
  scheduling: {
    mode: "per-tab",
    maxConcurrentTabs: 8,
    maxQueuedActions: 1_000,
  },
});

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

The client constructor performs no I/O. Image pull, create/resume, readiness, and CDP connection are
separate bounded operations. `DockerBrowser` owns the sandbox; a `PlaywrightBrowserConnection` owns
only its automation worker and CDP connection. Disconnecting automation never destroys Chromium.

## Lifecycle and cancellation

Playwright and its CDP protocol state run in a supervised child process, one per connection. This is an
intentional fault-containment boundary: Playwright 1.62.1 normally aborts its progress scope and closes
the transport on timeout, but an internal exception raised by a late protocol message is outside the
rejected `connectOverCDP()` promise. An in-process wrapper cannot guarantee host survival in that case.
The child boundary contains that exception without installing process-global `uncaughtException` or
`unhandledRejection` handlers.

`connect()` defaults to 30 seconds and passes the remaining budget to Playwright. Caller cancellation,
timeout, stop, and destroy terminate and join the worker before the attempt rejects. A worker response
that loses the cancellation race is ignored. A failed attempt owns no state in `DockerBrowser`, so a
later call starts a clean attempt.

Image pull, create, resume, stop, and destroy accept `timeoutMs` and `abortSignal`; their default budget
is 120 seconds. `disconnect()` defaults to 10 seconds. Docker sandbox destruction is irreversible and
cannot currently be cancelled. Once it starts, timeout or cancellation bounds only that caller's wait:
the browser remains visibly `destroying`, owns the eventual completion, and makes later `destroy()`
calls join the same cleanup. Late completion can only transition the terminal handle to `destroyed` or
`error`; it cannot restore agent or human control.
Timeout values are integer milliseconds from 1 through `2_147_483_647`, matching Node's timer range.

`stop()` first cancels pending readiness/connect work, disconnects all automation workers, and then
stops the sandbox. It also cancels pending human acquisition and releases an active lease, while
preserving the container. `resumeBrowser({ id })` returns a new handle and requires new readiness and
automation connections. `destroy()` is idempotent, joins pending work, invalidates human-control leases,
and removes the sandbox. Destroy remains available after a failed stop.
Concurrent stop, destroy, or disconnect calls join the first shared transition. A later caller's own
timeout or cancellation bounds its wait without rolling back that already-visible `stopping`,
`destroying`, or closed transition.

## Capability readiness

Readiness is not all-or-nothing:

| Capability   | What is proven                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `runtime`    | The Docker browser handle and sandbox are running.                                                        |
| `browser`    | Chromium's CDP port is reachable and `/json/version` exposes a WebSocket debugger URL.                    |
| `automation` | An isolated Playwright CDP connection initializes, exposes a context, and completes `Browser.getVersion`. |
| `desktop`    | The noVNC port and HTTP client page respond successfully.                                                 |

Use `waitForCapabilities()` to wait only for required capabilities and receive a
`BrowserReadinessSnapshot`. `waitUntilReady()` remains available and defaults to all four capabilities.
Both accept a required timeout and optional `AbortSignal`. `readiness()` is synchronous and reports
`unknown`, `checking`, `partial`, `ready`, `degraded`, `failed`, `stopped`, or `destroyed` state
without probing. `partial` means some capabilities are ready while others have not been checked;
`degraded` means at least one checked capability failed while another remains usable.

Desktop probing never establishes Playwright. A failed automation probe can therefore leave desktop
ready and the runtime degraded. Retrying readiness replaces the requested capabilities' prior failed
state. Caller cancellation restores their previous state. Stop and destroy abort and join every probe.

```ts
await browser.waitForCapabilities({ capabilities: ["desktop"], timeoutMs: 10_000 });
const snapshot = browser.readiness();

if (snapshot.capabilities.automation.state === "failed") {
  // The desktop may still be offered to a human while automation is retried or restarted.
}
```

## Concurrency guarantees

The default `{ mode: "serial" }` scheduling preserves the original selected-tab behavior: every tool
call on the connection executes in one bounded FIFO queue. This is the compatibility mode.

`{ mode: "per-tab" }` enables resource-scoped scheduling:

- Mutating operations for the same tab are FIFO and never overlap.
- Operations for different explicit tab IDs may overlap up to `maxConcurrentTabs` (default 8).
- Tab creation, listing, selection, and closure use a browser-context lock where necessary.
- A close marks its tab as closing before it queues. Work already queued runs first; later work is
  rejected with `invalid_state`.
- One failed operation releases its queue. Cancelling one tab closes that page to stop uncancellable
  Playwright work, then releases only that tab queue.
- If page cleanup itself cannot settle within five seconds, the worker is terminated and consumers
  reconnect. This fail-closed fallback can interrupt other tabs on that connection.
- Queue admission is bounded by `maxQueuedActions` (default 1,000) and ready tab queues are scheduled
  FIFO, one operation per turn, to avoid starvation.
- Disconnect, stop, or destroy reject queued work with a structured lifecycle error.

Concurrent tool dispatch does not imply concurrent execution when calls contend for the same tab,
browser-context state, selected-tab compatibility lock, or human-control gate.

Page tools now accept an optional `tabId`: `browser_navigate`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_press_key`, and `browser_screenshot`. Omitting it uses selected-tab compatibility
behavior. Obtain stable IDs from `browser_list_tabs` or `browser_open_tab`.
Tab IDs are stable for one automation connection; reconnecting creates a fresh ID namespace, so list
tabs again after reconnect.

The scheduling domain is one connection, and a `DockerBrowser` handle permits one active or pending
automation connection at a time. A second `connect()` rejects with `agent_action_busy`; share the first
connection among agents and dispatch explicit-tab work through it. This prevents independent workers,
ID namespaces, navigation-policy installations, and queues from racing over the same Chromium context.
Disconnect before creating a replacement connection. Automation readiness may use a short-lived,
non-mutating probe connection. Human control remains runtime-wide.

```ts
await Promise.all([
  snapshotTool.call({ tabId: researchTabId }),
  navigateTool.call({ tabId: monitoringTabId, url: "https://status.example.com" }),
]);
```

## Human and agent control

Human control is browser-wide and exclusive. Acquisition defaults to a 30-second wait and also accepts
`timeoutMs` and `abortSignal`. The arbitration policy is:

- Acquisition waits for active agent operations to finish.
- Pending acquisition rejects work that has not entered the control gate, including queued and newly
  dispatched work, with `human_control_conflict`.
- An active lease rejects agent work with the backward-compatible `human_controlled` code.
- A second acquisition is rejected; there is never more than one pending waiter or active lease.
- Cancellation/timeout removes pending state before rejecting.
- Renewal replaces the expiration timer atomically. Release, expiration, and destroy are idempotent.
- Agent work resumes after release or expiration.

`browser.desktop.control.snapshot()` reports `state` (`agent`, `agent-active`, `human-pending`, or
`human`), `activeAgentActions`, `humanPending`, lease data, and availability (`available`, `degraded`,
`disconnected`, or `destroyed`).

## Errors and recovery

Operational failures from public browser lifecycle/tool wrappers reject with `BrowserError`. Invalid
API arguments still throw `TypeError` or `RangeError`. The original operational error is retained as
`cause`; `code`, `retryable`, `recovery`, `phase`, and optional readiness `capability` support policy
decisions.

`retryable` describes whether the runtime has a documented recovery path; it does not make a mutating
tool call idempotent. After a timeout or transport loss, inspect or refresh tab state before deciding
whether replaying navigation, typing, clicking, or key input is safe.

| Codes                                                                   | Typical recovery                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `cancelled`, `action_timeout`, `lifecycle_timeout`, `agent_action_busy` | Retry the operation when appropriate.                               |
| `human_control_conflict`, `human_controlled`                            | Wait for acquisition/lease release or expiration.                   |
| `readiness_timeout`, `not_ready`                                        | Retry the failed capability; inspect `capability`.                  |
| `connection_timeout`, `connection_closed`, `transport_failure`          | Disconnect if needed, then create a new connection.                 |
| `tool_failed`                                                           | Retry the tool if its inputs and tab are still valid.               |
| `invalid_state`                                                         | Refresh tabs/state; restart when the runtime is stopped or errored. |
| `navigation_blocked`                                                    | Do not retry unchanged input; update the explicit policy or URL.    |
| `startup_failed`                                                        | Recreate the runtime after fixing image/runtime configuration.      |
| `runtime_destroyed`                                                     | Create or resume a new runtime handle.                              |

The legacy `not_ready` and `human_controlled` codes remain in the public union. New code should use
`retryable` and `recovery` rather than hard-coding all recovery policy.

## Browser tools and security

The tools use ARIA state and strict Playwright locators. They do not expose JavaScript evaluation, raw
CDP, coordinate input, shell access, hidden action retries, or automatic reconnection. The navigation
policy is installed across the default browser context, so top-level navigation from links, forms,
redirects, popups, and direct navigation is checked consistently. It does not block third-party
subresources; Docker bridge networking remains outside that policy.

The image runs Chromium as a non-root user with Chromium sandboxing, the Playwright seccomp profile,
every Linux capability dropped except `SYS_CHROOT`, no-new-privileges, and private shared memory.
Startup fails rather than switching Chromium to `--no-sandbox`. Docker bridge networking is not an SSRF
boundary; use infrastructure network policy for untrusted destinations.

The automation child process is a crash-containment boundary, not a privilege or tenant-isolation
boundary. It inherits the host application's OS identity; the Docker browser sandbox and application
authorization remain the security boundaries.

The VNC protocol uses exactly eight printable ASCII password characters. noVNC is published only on a
host-loopback Docker port, raw VNC is not published, and the password is not placed in image metadata,
URLs, environment variables, or logs.

## Playwright and Node compatibility

The host package and browser image pin `playwright-core` 1.62.1 together. Playwright requires matching
browser/package releases for its bundled browser and declares Node `>=20`; its current system matrix is
the latest Node 22, 24, or 26. Anvia CI uses Node 24, and the isolation regression test also runs on the
active host Node version. The package keeps its existing Node `>=20.12` engine for source compatibility,
but production deployments should use a currently supported Node 22, 24, or 26 release. Keep the image
and package pin aligned when upgrading.

The CDP connection is lower fidelity than Playwright's native protocol, but a native Playwright server
would conflict with this runtime's persistent, human-visible Chromium ownership. CDP remains the
appropriate protocol; isolation contains its in-process failure modes.

## Studio desktop and takeover

`browser.desktop` remains structurally compatible with Studio without a package dependency:

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
matching browser tool, Studio opens its programmatic noVNC viewer in a resizable Playground panel;
there is no stock noVNC toolbar, splash, or password prompt. Closing the panel restores Sessions and an
**Open browser** action restores the current desktop. Studio human takeover waits for active agent
actions, blocks new browser tool actions, and expires unless the viewer renews its lease. Takeover
coordinates trusted viewers; application authorization remains the security boundary.

See [MIGRATION.md](./MIGRATION.md) for selected-tab and readiness migration examples.
