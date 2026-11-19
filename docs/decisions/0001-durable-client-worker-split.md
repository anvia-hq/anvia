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

## Claim protocol as implemented in 4a

- **Modes.** A SQL store is opened as the exclusive owner (`acquire()`), a read-only observer
  (`connect()`), or a shared worker (`join()`). `join()` is read-write with no owner lease.
- **Owner and workers exclude each other through the owner row.** `join()` and every `claim()`
  lock the owner row `FOR SHARE` and fail while an owner's lease is live; `acquire()` locks it
  `FOR UPDATE` and fails while any unexpired claim exists. Both orders serialise on that row, so an
  owner and a worker cannot both start. `SQL_TABLES` does not include the claims table, so a
  database migrated before claims keeps opening for owners; `join()` verifies it.
- **Claiming.** `claim()` selects the same runnable set as `schedule()` (status, `retry_wait`
  due, dependencies met, the session's oldest unfinished run only) minus runs with an unexpired
  claim, then inserts a claim row per run with
  `ON CONFLICT (run_id) DO UPDATE ... WHERE expires_at <= now()`. That clause is the exclusion: a
  concurrent claimer waits on the row lock and then matches nothing. Leases use database time.
- **Fencing token.** The `claimId` (a UUID per claim) is the token. `tx.assertClaim(runId,
claimId)` takes the claim row `FOR SHARE` and throws `DurableClaimLostError` if it no longer
  matches, so a takeover waits for an in-flight write and a stale worker cannot commit after it.
  Expiry only matters to other claimers, not to the write path, so a worker that was merely slow
  keeps working until someone actually takes the run.
- **Renewal and release.** `renew()` extends only claims the worker still holds and returns
  `lost` for released, taken-over, or already settled runs. `release()` deletes by claim id, so a
  stale release cannot drop another worker's claim.

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
3. **Worker change detection (shipped on the stage-3 branch).** `pollIntervalMs` makes the
   runtime re-read the store so runs another writer made eligible are scheduled and an active run
   cancelled elsewhere is aborted, without relying on the in-process `pump()`/abort coupling. It is
   opt-in and covers agent runs; tasks and graphs follow with claims. The default flips on in
   stage 5, and a store notification (Postgres `LISTEN/NOTIFY`) is the later latency optimisation.
4. **Claims and fencing** on Postgres; SQLite keeps single-owner. Split into:
   - **4a. Store layer (shipped on the claims branch).** `join()`, `claim()`, `renew()`,
     `release()` and `tx.assertClaim()` on the SQL store, plus the `anvia_durable_claims` table.
     The runtime does not use them yet.
   - **4b. Runtime worker mode (shipped on the worker-mode branch).** `worker: {...}` on
     `DurableRuntime.open` joins as a shared worker, claims runs, renews on a heartbeat, aborts a
     run whose claim it loses, and releases claims when a run settles or the runtime closes. Fencing
     uses an async context: every transaction started inside a run's execution begins with
     `assertClaim`, so no write path can forget it. The terminal writes (completion and failure)
     also refuse to overwrite a run that was settled elsewhere. A failed renew retries on the next
     beat, and a full lease without one success aborts every held run, since another worker may
     hold them. Agent runs only: tasks, graphs, and goals are rejected in this mode.
   - **4c. Client writes (shipped on the client-writes branch).** `DurableClient` submits, cancels,
     responds, resolves, retries and steers without a claim or an agent. The transactions behind
     those operations moved out of `DurableRuntime` into `mutations.ts` so both use one
     implementation. Making that safe needed three store changes: a run read in a read-write
     transaction is locked (`FOR UPDATE`) when the store is shared, so a worker and a client cannot
     lose each other's updates; `lockSession` serialises submissions to one session; and `claim()`
     takes `agentIds` so a worker never claims a run it cannot execute. A client has no
     registration, so its runs are created `unadmitted` and the claiming worker admits them against
     its own registration (`admitRunRecord`) before the first attempt.
5. **Public `DurableClient` and `DurableWorker` (shipped on the worker-class branch).**
   `DurableClient` arrived with 4c; `DurableWorker.start()` is the worker role over
   `DurableRuntime` in worker mode, without submit or control methods. A worker's
   `unregisterAgent()` no longer refuses because of unfinished runs in the store, since another
   worker may execute them. The planned "flip polling on by default" is narrower than first
   written: workers already poll every second, while an owning runtime has no other writer to
   notice (an owner and clients cannot share a database), so its default stays off.
6. Typed events and protocol bridge; registration fingerprinting; unify with tasks.
   - **6a. Typed events (shipped on the typed-events branch).** `isDurableEvent` and
     `DurableEventPayloads` type each event's payload without changing `DurableEvent`, so it is
     additive. The payload shapes were read from every `appendEvent` call and a test checks them
     against a real run. A runtime-validated discriminated union stays deferred: `submitted` and
     `status` are shared by runs, graphs and tasks, so a strict union needs those split first.
   - **6b. Graphs under claims (shipped on the worker-tasks branch).** Graph tasks are ordinary
     runs with dependencies, so claims already schedule them. `submitGraph`, `getGraph`,
     `graphSnapshot` and `cancelGraph` now work in worker mode and on `DurableClient`; tasks for
     unregistered agents are stored unadmitted. Custom tasks and goals (`definition.run` user
     code, tree reconciliation, deadlines) are not covered and still need their own claim design.
   - **6c. Protocol bridge, registration fingerprinting, custom tasks under claims.** Not started.

## Consequences

- Existing `runtime.submit()`, `registerAgents()`, and `result()` keep working through 1 to 5.
- `store.acquire()` is replaced by `connect()` plus claims. Custom `DurableStore` implementations
  are affected at stage 4, which is acceptable at `0.x` but needs a minor changeset and a note.
- Heartbeats and polling add steady store load; the interval is a worker option with a safe
  default and the notification path is the optimisation.
- Task and graph schedulers use the same owner lease today and need the same claim treatment.
- Risk: the fencing check must cover every worker write path, including recorded memory and task
  transitions. Stage 4 needs a journal-level test that a stale claim cannot commit.
