# Hosting, HTTP, and operational controls

Contents: package boundaries; HTTP authorization; client reconnection; limits and health;
version changes; backup and release gates.

## Packages and hosting

- `@anvia/durable`: runtime, custom task definitions/handles, graph handles, errors, and types.
- `@anvia/durable/sqlite`: local `SqliteDurableStore`, Node.js 22.16+.
- `@anvia/durable/protocol`: browser-safe types and validators.
- `@anvia/durable/maintenance`: offline `backupSqlite` / `restoreSqlite`.
- `@anvia/server/durable`: Fetch-compatible `createDurableHandler`.
- `@anvia/client/durable`: browser-safe `DurableClient`.

Use matching package versions. In the Anvia repository, build core and durable before consuming
new public types from client/server. Do not import SQLite or the server runtime into browser code.
The application owns its server, identity, startup, and shutdown. Durability does not keep a
stopped machine awake; use a process supervisor and a persistent local volume.

## HTTP and ownership authorization

```ts
import { createDurableHandler } from "@anvia/server/durable";

const handler = createDurableHandler({
  runtime, // one shared runtime opened during startup
  basePath: "/durable",
  maxBodyBytes: 65_536,
  authorize: async (request, resource) => {
    const user = await authenticate(request); // application implementation
    return user !== null && (await canAccessDurableResource(user, resource));
  },
});
```

Authenticate and authorize reads, list rows, event subscriptions, and mutations. The resource
includes `action`, owning `sessionId`, and applicable `agentId`, `runId`, `graphId`, `taskId`,
`rootTaskId`, and `taskName`. Owned agent runs map to the parent task's session, not their reserved
generated session. `runtime.runScope(runId)` exposes lightweight owner metadata to trusted host
code. Do not authorize from an untrusted session field supplied alongside an existing run ID.

Allowlist task definitions and agents. Granting submission/retry for a definition also authorizes
its code to spawn children; the HTTP layer cannot enforce a per-spawn permission for application
code. If a business policy constrains delegated work, enforce it in that trusted definition and
its validated input. Bind session IDs to the authenticated tenant. Add host CORS/CSRF controls as
appropriate. The journal contains prompts, tool results, signals, and checkpoints, not just metrics.

Task tree reads/cancellation authorize existing nodes. A new child appearing during cancellation
authorization causes HTTP 409 without mutating the tree; retry to authorize the current tree.
Tree events reauthorize each emitting task, including dynamically created children, before sending
that event. A denial interrupts streaming. Other run/static-graph subscriptions authorize on
attachment; do not assume token revocation automatically closes an existing connection. Global
metrics/health are not exposed by default because these routes use session-scoped authorization.

## Client operations and reconnection

```ts
import { DurableClient } from "@anvia/client/durable";

const client = new DurableClient({
  endpoint: "https://your-app.example/durable",
  headers: () => ({ Authorization: `Bearer ${getAccessToken()}` }),
});
const accepted = await client.submitTask({
  name: "research-report", // registered on the server; no executable code comes from the client
  version: 1,
  sessionId: "tenant-42:project-7",
  requestId: "report-123",
  input: { topic: "Evaluate the supplied incident notes" },
});
const graph = await client.taskGraph(accepted.task.id);
renderGraph(graph);
for await (const event of client.streamTask(accepted.task.id, { after: graph.cursor })) {
  renderGraph(await client.taskGraph(accepted.task.id));
}
```

Application functions in this snippet supply credentials and rendering. The client validates
JSON envelopes, identities, and increasing event cursors. For higher event volume, coalesce
refreshes rather than fetching a graph for every event. A fresh snapshot's cursor is authoritative;
an event notification plus a refreshed graph need not represent the exact same moment.

| Work         | Client methods                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent runs   | `submit`, `snapshot`, `listRuns`, `stream`, `respond`, `resolveTool`, `retry`, `cancel`                                        |
| Custom tasks | `submitTask`, `taskSnapshot`, `listTasks`, `taskGraph`, `streamTask`, `signalTask`, `resolveEffect`, `retryTask`, `cancelTask` |
| Static DAGs  | `submitGraph`, `graphSnapshot`, `listGraphs`, `streamGraph`, `cancelGraph`                                                     |

Task routes live under `/durable/tasks`; run routes under `/durable/runs`; static DAGs under
`/durable/graphs`. Task control bodies are `{ name, requestId, value }` for `/signal` and
`{ key, value }` for `/resolve-effect`. Agent `/respond` uses `{ interactionId, response }`;
`/resolve-tool` uses `{ operationId, output }`. Do not interchange these payload shapes.

HTTP listings require a session ID and support insertion pagination. Owned runs are discovered
through their tree/graph, not a root-session `listRuns` call. Tree streams include the whole
root even when opened using a child handle. Aborting a request/subscription does not cancel the
job. Reconnect explicitly from a new snapshot or last applied event cursor. The client does not
retry mutations automatically; preserve submission/delivery IDs when the caller retries.

Expect 400 for invalid input, 403 for denial, 404 for missing resources, 409 for conflicts,
413 for body size, 415 for content type, 429 for durable limits, and 503 for fatal storage failure.
Unexpected errors return 500. After an SSE stream is established, a failure interrupts the stream
rather than changing its HTTP status. Treat transport failure as unknown delivery, not proof a
mutation never committed. Saved snapshots are the source of execution state.

## Health, quotas, and shutdown

`runtime.health()` does not query storage: it reports `ready`, `failed`, `closing`, or `closed`
and active run/task counts. `runtime.metrics()` reports aggregate status counts, unfinished-work
age, operation/event totals, and SQLite page allocation. It excludes WAL/SHM sizes; separately
monitor disk free space and file growth. Metrics aggregate tables; scrape periodically rather
than per request. `onFatalError` runs once per failed owner; redact errors before sending them to
logs or telemetry. A thrown diagnostic callback does not restore or replace a journal failure.

Default limits are 10,000 unfinished runs, 10,000 unfinished tasks, 1 MiB per bounded JSON payload,
and 10,000 operations per execution. Configure through `DurableRuntime.open({ limits: ... })`.
Independent run/task concurrency defaults to 4 each. Payload caps apply to persisted fields,
not arbitrary application memory allocations. A separate bounded diagnostic allowance permits
failure/cancellation propagation; previously admitted owned-agent outputs survive lower quotas.
Quotas do not expire history or limit total disk growth. Avoid storing large files in results;
persist bounded identifiers and use application-managed blob storage where appropriate.

Admission and insertion are atomic; duplicate identical submissions remain retrievable at capacity.
A task that hits a recoverable quota block can resume after the limit is raised. An oversized
external effect result needs reconciliation because the action may have happened already.
Storage failures stop both schedulers, abort callbacks, and reject subsequent work. Repair the
underlying cause before restarting. If failed close cannot clear ownership while the old PID is
still alive, restart the owning process; do not forcibly clear a live-owner row.

Use explicit `cancel()` for user cancellation. Use `close()` for service shutdown, preserving
unfinished work for restart. Neither undoes side effects. Callbacks must honor AbortSignals;
set an application/supervisor shutdown grace period for non-cooperative code. There are no built-in
durable execution deadlines, automatic retention, or process failover.

## Version changes and backup

Agent versions are strings requiring compatible code restoration. Task versions are positive
integers. A newer custom definition can provide pure `migrate(input, checkpoint, fromVersion)`
returning schema-valid `{ input, checkpoint }`; migration and activation commit together.
Preserve saved effect keys, child keys, and their meaning. Migrations do not rewrite journals or
consumed child outcomes. A missing/older definition or missing migration blocks activation.
An already blocked task requires explicit retry after compatible code is restored.

SQLite schema 3 upgrades schemas 1/2 on acquisition. Older engines reject schema 3. There is no
automatic downgrade. Back up compatible state and retain application artifacts before an upgrade.
Maintenance helpers currently accept schema 3 only; use an infrastructure-level consistent offline
snapshot before upgrading an older schema.

```ts
import { backupSqlite, restoreSqlite } from "@anvia/durable/maintenance";

await runtime.close();
await backupSqlite("./durable.sqlite", "./backup.sqlite");
// Later: keep the original deployment stopped and restore into a new file.
await restoreSqlite("./backup.sqlite", "./restored.sqlite");
```

These are explicit maintenance actions, not startup steps to run on every request. Backups acquire
offline ownership, include committed WAL state, and seal the copy. A sealed backup cannot run until
restored. Both operations refuse existing destination files or SQLite sidecars. Use a dedicated
offline destination directory; never delete unrelated sidecars to bypass that check. The archive
contains private payloads; protect it. A reported error after publication may leave a destination
file, so inspect it before retrying. No remote upload or retention rotation is performed.

Restoration to another path does not fence an original deployment. Keep the original stopped,
restore matching definitions, inspect unfinished work, and audit effects performed after the backup
before calling `resume()`. The external service may have performed work absent from the snapshot.
Practice restoration with effects disabled or mocked. There is no automatic rollback of payments,
notifications, or other external state.

The local smoke script demonstrates package compatibility and clean-reopen semantics. Production
qualification still needs workload-specific process-kill tests, actual storage-failure drills,
a prolonged load run on the target filesystem, and a measured restore/rollback exercise. Keep
this distinction explicit when reporting readiness; do not add a durable cookbook while that
production-readiness work remains incomplete.
