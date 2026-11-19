# 0001: Split the durable client from the worker

Status: Proposed. One open question below needs a maintainer decision.

## Context

`@anvia/durable` exposes everything through `DurableRuntime`: the executor (scheduler,
`resume()`, `maxConcurrentRuns`) and the client (`submit`, `stream`, `result`, `cancel`,
`respond`). `DurableRun` holds a `DurableRuntime`, so a process that only wants to submit and
observe must open a full executing runtime. One runtime owns one database (a heartbeat lease on
Postgres), so every observer is also the single executor.

Agent runs, tasks, graphs, and goals also live on the same class, as parallel models of durable
work. The package is at `0.x` and experimental, so this can still change in a minor release.

## Decision

1. Keep the single-owner execution model for now. Do not add per-run leases or multiple workers
   until a concrete need exists (see the open question).
2. Introduce the seam first, without breaking anything: a typed `DurableAgentHandle<Output>` and a
   typed `DurableRun<Output>` (shipped together with this ADR). New sugar attaches to these types,
   not to more methods on `DurableRuntime`.
3. Introduce `DurableRunClient` and `DurableSubmitClient` interfaces (shipped here). `DurableRun`
   and `DurableAgentHandle` depend on them, not on the runtime class, with no behaviour change.
   A store-only `DurableClient` (submit, get, list, stream, result, steer, respond, cancel) that
   needs no executor is a later step, blocked on the two findings below.
4. Later, type `DurableEvent` as a discriminated union and map it to the `@anvia/client` stream
   protocol.
5. Later, fingerprint registrations (instructions, tool schemas, model id, output schema) so a
   changed registration under an unchanged `version` is detected.
6. Last, treat an agent run as one kind of durable task so agent runs and tasks, graphs, and goals
   share one model. This needs its own design.

Keep: idempotent `(sessionId, requestId)` submission, observe-only run handles, explicit
`{ mode: ... }` markers, and durability living outside `@anvia/core`.

## Findings that block a store-only client

Every client operation in `DurableRuntime` is a store transaction followed by in-process effects,
so a facade over today's code would be incorrect:

- **Exclusive ownership.** `store.acquire()` takes the owner lease: SQLite throws when a live owner
  exists, Postgres uses a lease row. A client process cannot open the same database without
  becoming the owner. Stores need a non-owning access mode (no lease, no migration) first.
- **Worker wake-up and abort are in-process.** After a submit, respond, resolve, or retry the
  runtime calls `pump()`, and `cancel()` aborts the active run through an in-memory controller. A
  separate client can only write to the store, so the worker must notice new pending runs and
  cancellations itself, by polling or a store notification.

## Open question

Do we need several workers against one database? If yes, step 3 must include per-run leases and a
claim protocol, and should happen before the API hardens. If no, document the one-executor limit
and keep `DurableClient` as a read and write facade only.

## Consequences

- Existing `runtime.submit()` and `registerAgents()` keep working.
- `result()` keeps waiting through `needs_attention` by default; `onBlocked: "throw"` is opt-in.
- Steps 3 (store-only client) to 6 are separate changes with their own changesets, and the first
  two need store and worker changes, not only API work.
