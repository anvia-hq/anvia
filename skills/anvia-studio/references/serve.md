# Serving Agents

`@anvia/studio` serves local agents, pipelines, and agent teams over HTTP with
a browser UI. Register what you already built — Studio does not redefine agents.

```ts
import { Agent, AgentTeam } from "@anvia/core/agent";
import { Studio } from "@anvia/studio";

const researcher = new Agent({ id: "researcher", model });
const team = new AgentTeam({ id: "research-team", model, members: [researcher] });
await new Studio([researcher, team]).serve({ port: 4021 });
```

- `serve({ port })` starts HTTP + UI; `.start()` is the non-awaited variant.
  Without a port, Studio uses `RUNNER_PORT`, then falls back to `4021`.
- The playground lives at `/ui/playground`.
- A Studio with only teams opens its first team automatically; agent and team
  IDs occupy separate namespaces.

## Sessions

Studio uses an in-memory store by default — sessions, traces, and run history
vanish on restart. Persist with SQLite:

```ts
import { Studio, createSqliteSessionStore } from "@anvia/studio";

new Studio([agent], {
  stores: { sessions: createSqliteSessionStore({ path: ".anvia/studio.sqlite" }) },
}).start();
```

SQLite uses dedicated `anvia_studio_*` tables, so it can share an application
database without touching product tables.

## Lifecycle

- `serve()` handles `SIGINT`/`SIGTERM`: stops accepting work, aborts active
  Agent and Pipeline runs, waits for cancellation observers, then runs
  `onShutdown` — close observability clients and other caller-owned resources
  there.
- `shutdown()` drains the same way for application-managed lifecycles;
  `close()` aborts without waiting (compatibility only).

## Runs

The primary execution API is `POST /agents/:agentId/runs`: it streams JSONL
events and accepts interaction-resume bodies, so scripts and CI can drive an
agent without the browser UI.

## Teams

Team runs stream JSONL events (`POST /teams/:teamId/runs`), with steer, cancel,
and per-interaction resolve endpoints. Approvals and questions surface as cards
labeled with the requesting member; several members may block at once. Team
tasks are page-local and ephemeral — they never enter saved agent sessions.

## Rules

- Studio provides no authentication. Apply auth middleware to execution routes
  before exposing it beyond localhost.
- Disconnecting a stream or shutting down cancels the run and its pending
  interactions — completed runs leave the live registry (later control calls
  404), and team runs are not resumable.
