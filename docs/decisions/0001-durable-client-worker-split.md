# 0001: Split the durable client from the worker, with per-run claims

Status: Accepted direction. The seam and typed handles ship now; the claim protocol is staged
below and each stage is its own change.

## Context

`@anvia/durable` exposes everything through `DurableRuntime`: the executor (scheduler,
`resume()`, `maxConcurrentRuns`) and the client (`submit`, `stream`, `result`, `cancel`,
`respond`). One runtime owns one database: `store.acquire()` takes an exclusive owner lease
(SQLite throws when a live owner exists; Postgres uses a lease row with a heartbeat). `DurableRun`
held a `DurableRuntime`, so a process that only wanted to submit and observe had to open a full
executing runtime.

Two further facts shape the fix. Every client operation is a store transaction followed by
in-process effects: `pump()` wakes the scheduler, and `cancel()` aborts the active run through an
in-memory controller. And agent runs, tasks, graphs, and goals are parallel models on one class.

The package is `0.x` and experimental, so a structural change is cheap now and expensive after the
API hardens.

## Decision

Make the store, not the process, the source of truth for who runs what. Adopt **per-run claims
with leases**, and make the client a thin, store-only role.

1. **Roles.** `DurableClient` (submit, get, list, stream, result, steer, respond, resolve, retry,
   cancel) needs no executor and never owns the database. `DurableWorker` executes runs. The
   existing `DurableRuntime` stays as a client plus a worker for compatibility and for the
   single-process case.
2. **Claims replace the database lease.** A worker claims runs with a lease, renews them on a
   heartbeat, and releases them on completion. Several workers can share one database; a crashed
   worker's runs become claimable when its lease expires.
3. **Fencing.** Each claim carries a fencing token (the run `epoch` plus a claim id). Every
   worker-side mutation checks it inside the same transaction, so a worker that lost its lease
   cannot commit stale results.
4. **State changes go through the store.** Cancel, respond, resolve, retry, and submit only write
   to the store. Workers observe them: a lost or cancelled claim aborts the in-memory attempt on
   the next renew, and new work is found by polling, with an optional store notification
   (Postgres `LISTEN/NOTIFY`) to cut latency.
5. **Session order is a store invariant.** The oldest eligible run per session is the only
   claimable one; `excludedSessions` stops being in-memory worker state.
6. **Backends declare capability.** Postgres (and Drizzle/Prisma over it) supports many workers.
   SQLite stays single-owner and declares it, instead of defining the model for everyone.
7. **Keep:** idempotent `(sessionId, requestId)` submission, observe-only run handles, explicit
   `{ mode: ... }` markers, and durability living outside `@anvia/core`.

Also decided, independent of workers: type `DurableEvent` as a discriminated union and map it to
the `@anvia/client` stream protocol; fingerprint registrations so a changed registration under an
unchanged `version` is detected; and treat an agent run as one kind of durable task so runs,
tasks, graphs, and goals share one model (own design, last).

## Sketch of the store contract

```ts
interface DurableStore {
  // replaces acquire(): no exclusive ownership
  connect(): Promise<void>;
  claim(input: { workerId: string; now: string; limit: number; leaseMs: number }): Promise<Claim[]>;
  renew(input: { workerId: string; claims: readonly ClaimRef[]; leaseMs: number }): Promise<{
    lost: ClaimRef[]; // reassigned, cancelled, or expired
  }>;
  release(claims: readonly ClaimRef[]): Promise<void>;
  // transaction() gains a claim guard: worker writes pass { claim } and fail when it is stale
}
type ClaimRef = { runId: string; claimId: string; epoch: number };
```

## Staging

Each stage is independently shippable and keeps `DurableRuntime` working.

1. **Seam (this PR).** `DurableRunClient` / `DurableSubmitClient`; `DurableRun` and
   `DurableAgentHandle` depend on them. Typed handles and `onBlocked` ship alongside.
2. **Non-owning, read-only store access (shipped on the stage-2 branch).** `DurableStore.connect()`
   opens a store without a lease or migration, enforced read-only by the database (SQLite
   `query_only`, Postgres `SET TRANSACTION READ ONLY`). `DurableObserver` builds on it. It is
   read-only on purpose: until claims and fencing exist (stage 4), a second writer racing the
   owner, which assumes it is the sole writer, could lose updates. Client writes arrive with
   stage 4.
3. **Worker change detection.** Polling (and optional notification) for pending runs and for
   cancellation, replacing the in-process `pump()`/abort coupling.
4. **Claims and fencing** on Postgres; SQLite keeps single-owner.
5. **Public `DurableClient` and `DurableWorker`.** Mostly assembly once 2 to 4 exist.
6. Typed events and protocol bridge; registration fingerprinting; unify with tasks.

## Consequences

- Existing `runtime.submit()`, `registerAgents()`, and `result()` keep working through 1 to 5.
- `store.acquire()` is replaced by `connect()` plus claims. Custom `DurableStore` implementations
  are affected at stage 4, which is acceptable at `0.x` but needs a minor changeset and a note.
- Heartbeats and polling add steady store load; the interval is a worker option with a safe
  default and the notification path is the optimisation.
- Task and graph schedulers use the same owner lease today and need the same claim treatment.
- Risk: the fencing check must cover every worker write path, including recorded memory and task
  transitions. Stage 4 needs a journal-level test that a stale claim cannot commit.
