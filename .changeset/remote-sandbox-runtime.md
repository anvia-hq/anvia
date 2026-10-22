---
"@anvia/sandbox": minor
---

Add a remote sandbox runtime. `RemoteSandboxHub` (`@anvia/sandbox/remote`) accepts outbound
WebSocket connections from `anvia-sandbox-daemon` (or the embeddable `SandboxDaemon` from
`@anvia/sandbox/daemon`), authorizes them with a caller-supplied `authorize(token)`, and returns a
`SandboxRuntime` per sandbox through `hub.runtime(id)`. The daemon owns process state and logs, so a
control-plane restart only needs to reconnect; calls wait up to `connectTimeoutMs` and then fail
with the new `sandbox_unavailable` error code. `hub.forget(id)` releases the hub's per-sandbox
records when a sandbox is destroyed.

Mutating runtime methods (`exec`, `writeFile`, `writeTextFile`, `startProcess`, `stopProcess`)
accept an optional `operationId`, which the daemon executes once through a bounded on-disk table.
`createSandboxTools` forwards `ToolCallContext.operationId`, so those tools can be marked
`idempotent` in `@anvia/durable`. `SandboxRuntime.waitForPort` now returns a `SandboxPortStatus`
whose `host` and `hostPort` are optional (Docker still returns both), and the `wait_for_port` tool's
`host` and `hostPort` output fields are optional to match. The daemon runs on POSIX hosts and adds
`ws` as a dependency.
