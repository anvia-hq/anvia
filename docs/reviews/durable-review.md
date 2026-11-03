# `@anvia/durable` review: payload limits, `useChat` interoperability, Agent parity

Review of `@anvia/durable` 0.12.2 in the Anvia monorepo.

- Repository: `/workspace`, branch `aven/e71abe9a`
- Commit reviewed: `b567bbf0f6a00c1a5b8804a22245b2872ea0a3f8` (`chore(env): add reproducible thread environment and Ship behavior (#606)`, 2026-11-02)
- Package version: `packages/durable/package.json:3`
- Review date: session 1 of the durable review goal
- Scope: review and design only. No `packages/` or `.changeset/` changes are proposed here as code.

## Executive summary

The three user reports are all rooted in real behaviour, but two of them point at the wrong
mechanism, and the most serious defect is one the report did not name.

1. **"It limits input to 1 MB."** Substantially true, and the real ceiling is usually much lower.
   `maxPayloadBytes` defaults to 1,048,576 bytes and is applied **separately to seven persisted run
   fields, to task fields, to operation input/result, and to each streamed delta**
   (`packages/durable/src/limits.ts:14`, `packages/durable/src/limits.ts:55`). The shipped HTTP
   handler defaults to a **65,536-byte request body** (`packages/server/src/durable.ts:75`), so a
   client cannot send a 1 MB prompt through the documented bridge at all; it receives HTTP 413
   before the runtime sees the request. Base64 expands images by ~4/3, and the same content is
   counted again in `input`, `history`, `outcome`, and the model operation request.
   More importantly, **a session whose inherited history crosses the limit does not fail cleanly**:
   the run is parked in `needs_attention`, `run.result()` never settles, the SSE stream never ends,
   retry repeats the state, and — verified — **retry silently drops the inherited history and
   completes with only the new prompt**, permanently truncating the conversation for later turns.
   See DUR-03 and DUR-04.

2. **"`useChat()` from `@anvia/react-ui` cannot interact with durable."** Correct, and intentional
   per the docs (`docs/packages/durable.md:547`: durable progress "is not the existing token-delta
   chat protocol"). `useChat` consumes `ClientTransport.send()` frames in the `anvia.client.v3`
   protocol (`packages/client/src/types.ts:367`), while durable exposes its own SSE event list and
   `DurableClient` (`packages/client/src/durable.ts:255`). There is no frame envelope, no
   `messages` → `prompt` mapping, no `runId` in the client contract, and `stop()` means "abort the
   fetch", not "cancel the run". A client-side adapter is feasible and is the recommended first
   step; a server-side protocol bridge is the better long-term product shape but is a larger piece
   of work. See DUR-10 to DUR-13.

3. **"Many `Agent()` features are not supported."** Correct. Registration rejects eight feature
   groups outright (memory, lifecycle, middleware, guardrails, context sources, MCP servers,
   provider tools, tool indexes) with one combined error (`packages/durable/src/registration.ts:26`).
   Several other features are **silently partial**: agent-level `retries` are forced off
   (`packages/durable/src/runtime.ts:717`), per-run settings (`maxTurns`, `guardrails`, `lifecycle`,
   `toolConcurrency`, `middlewares`, `controls`) are not exposed, structured output must be
   JSON-serializable (`packages/durable/src/schema.ts:31`), and compaction is registration-only.
   The complete matrix and a phased design are in
   [`durable-agent-parity.md`](./durable-agent-parity.md).

What is healthy: the journal is defensive (immutable linked history, write-ahead operations,
transactional admission), the test suite is broad (239 tests across 22 files, including SIGKILL
recovery), failures are usually fail-closed, and `DurableClient` validates every event and refuses
cross-run or out-of-order data. The defects below are mostly about **boundary semantics**, not about
journal correctness.

## Method

### Environment and commands actually run

`node_modules` was absent at the start. `pnpm install --frozen-lockfile` initially failed because
`node-pty` runs `node-gyp rebuild` and no working `node-gyp` was on `PATH` (`ELIFECYCLE`, "node-gyp:
Permission denied"). Following `.aven/setup`, `node-gyp` was installed under `$HOME/.npm-global` and
the install was rerun:

```sh
npm install -g node-gyp --prefix "$HOME/.npm-global"
PATH="$HOME/.npm-global/bin:$PATH" pnpm install --frozen-lockfile --reporter=append-only
# EXIT:0, 1m 27.9s

pnpm --filter @anvia/core build        # BUILD_EXIT:0
pnpm --filter @anvia/durable typecheck # TYPECHECK_EXIT:0
pnpm --filter @anvia/durable test      # TEST_EXIT:0, 22 files, 239 tests, 48.14s
```

The durable typecheck and test suite therefore **pass on this commit**. Core was built because
`@anvia/core` resolves through `dist` outside vitest.

Temporary verification tests (not committed) were added under `packages/durable/test/` and
`packages/server/test/`, run with the package's own vitest, and deleted before the commit:

```text
SCRATCH growth report [{"turn":1,"status":"completed","history":0,"modelTurns":1},
 {"turn":2,"status":"completed","history":2}, {"turn":3,"status":"completed","history":4},
 {"turn":4,"status":"completed","history":6},
 {"turn":5,"status":"needs_attention","error":"Durable payload byte limit exceeded.","history":0}]
SCRATCH blocked details {"settled":"still-waiting","afterRetry":"completed","nextStatus":"completed",
 "requestRoles":[["user"],["user","assistant","user"],["user","assistant","user","assistant","user"],
 ["user","assistant","user","assistant","user","assistant","user"],["user"],["user","assistant","user"]]}
SCRATCH tool failure {"status":"needs_attention","error":"Could not record the tool result: Durable payload byte limit exceeded.","blocked":"0:tool:1:call-1"}
SCRATCH request-limit {"status":"failed","error":"Durable payload byte limit exceeded."}
SCRATCH http body limit {"isHttpError":true,"status":413,"message":"Durable request failed with HTTP 413."}
SCRATCH http 413 body 413 {"error":"Durable request body is too large"}
SCRATCH http payload limit {"isHttpError":true,"status":429,"message":"Durable request failed with HTTP 429."}
SCRATCH http 429 body 429 {"error":"Durable payload byte limit exceeded."} null
```

The scratch tests used tiny limits (1,000–2,000 bytes) and short outputs so the behaviour is
reproducible in milliseconds; the same code path is size-independent. The 1 MiB default itself was
not exercised with a 1 MiB payload — the arithmetic is done from the code and the scaled runs.

### Read versus executed

| Area           | Read                                                                                                                   | Executed                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Payload limits | `limits.ts`, `storage-guard.ts`, `sqlite.ts`, `message-log.ts`                                                         | scaled-limit session growth, oversized tool output, oversized model request |
| HTTP bridge    | `server/src/durable.ts`, `durable-http.ts`, `client/src/durable.ts`                                                    | 413 vs 429 mapping, response bodies, client error shape                     |
| Client/useChat | `client/src/types.ts`, `client-transport.ts`, `messages.ts`, `react/src/use-chat.ts`, `react-ui/src/contexts/chat.tsx` | read-only; no browser or React test was run                                 |
| Agent parity   | `core/src/agent/types.ts`, `run-types.ts`, `resolve-options.ts`, `durable/src/registration.ts`, `runtime.ts`           | read-only plus the registration test suite                                  |
| Docs           | `docs/packages/durable*.md`, `README.md`, `CHANGELOG.md`                                                               | read-only                                                                   |

Not verified: a live provider call, a real 1 MiB upload through a browser, React rendering of the
proposed adapter, and SQLite behaviour at production scale. Claims that depend on those are marked
as inferred.

## Severity table

| ID     | Severity     | Area               | Summary                                                                                                                                                            |
| ------ | ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DUR-01 | High         | Limits             | 1 MiB is a per-field, per-request cap measured on expanded JSON; a "1 MB input" is not admitted end to end.                                                        |
| DUR-02 | High         | Limits/HTTP        | Default HTTP body limit (64 KiB) rejects most real images and long documents with 413, far below the documented 1 MiB payload limit.                               |
| DUR-03 | **Critical** | Limits/Recovery    | Growing session history parks the run in non-terminal `needs_attention`; `result()` and SSE never finish, retry and new submissions repeat it.                     |
| DUR-04 | **Critical** | Limits/Correctness | Retrying a payload-blocked run silently drops inherited history and completes; later turns lose the earlier conversation.                                          |
| DUR-05 | Medium       | Limits/Recovery    | Oversized tool output blocks for reconciliation and works when the resolved output fits; oversized model outcomes fail terminally. Both need manual limit changes. |
| DUR-06 | Medium       | Errors             | 429 conflates admission and payload failures, carries no code or `Retry-After`, and `DurableClient` discards the message.                                          |
| DUR-07 | Medium       | Journal            | `status` events persist the full outcome (and continuation) without the payload check; every `putRun` re-stringifies history/input/outcome.                        |
| DUR-10 | High         | useChat            | No protocol overlap: durable emits its own events, `useChat` requires `stream_start`/`stream_event`/`stream_end`.                                                  |
| DUR-11 | High         | useChat            | Request mapping, interaction-to-run mapping, resume cursor, and disconnect semantics all need an adapter; `stop()` ≠ `cancel()`.                                   |
| DUR-12 | Medium       | useChat            | Durable events lack message/part IDs, use a global sequence, and expose no context usage; the adapter must synthesize protocol state.                              |
| DUR-20 | High         | Parity             | Eight `AgentOptions` feature groups are rejected at registration.                                                                                                  |
| DUR-21 | High         | Parity             | Silent partials: `retries` forced off, per-run settings unavailable, structured output JSON-only, compaction registration-only.                                    |
| DUR-30 | Medium       | Docs               | Documentation contradicts the code and itself on steering and schema version; it understates the HTTP body limit.                                                  |
| DUR-31 | Medium       | Tests              | No test covers history-growth limits, retry-after-block history loss, or HTTP body vs payload limits.                                                              |
| DUR-32 | Low          | Observability      | Limit failures are generic error strings; no counter, event type, or field information.                                                                            |
| DUR-33 | Low          | Deployment         | `instanceof DurableLimitError` mapping depends on one module instance; duplicated package copies turn 429 into 500.                                                |

## Findings

Each finding states evidence as `path:line`, impact, root cause, options with trade-offs, a
recommendation, and effort/risk. Effort is relative engineering effort for a maintainer who knows
the package (S ≤ half a day, M ≤ two days, L > two days).

### 1. Payload limits

#### DUR-01 — The payload limit is a per-field cap, not a 1 MB input budget

**Evidence:** `packages/durable/src/limits.ts:14` (default `maxPayloadBytes: 1_048_576`),
`packages/durable/src/limits.ts:29` (UTF-8 byte length of `JSON.stringify`), `:55` (run keys checked
individually), `:43` (checked only when the value changed), `:88` (operation input and result),
`packages/durable/src/execution.ts:111` (each model operation persists provider, model, and the full
request), `packages/durable/src/compaction.ts:56` (the projected history is re-derived from
`run.history`), `docs/packages/durable-operations.md:62` (docs say the limit applies "separately").

**Impact.** A "1 MB prompt" is not accepted end to end. The canonical prompt is counted in
`run.prompt`, again in `run.input`, again in the model operation request (which also contains the
provider/model envelope), and later in `history` and `outcome` after the run completes. A prompt of
~0.9 MB passes submission but makes every model call exceed the operation limit once any history
exists; the run fails with a generic payload error. Base64 inflates images by ~4/3, so a 1 MB image
becomes ~1.4 MB before JSON overhead and is rejected (`packages/durable/test/multimodal.test.ts:177`
covers the scaled case). The error text never says which field or by how much.

**Root cause.** The limit is implemented as a transaction guard on individual persisted values
rather than as an admission policy with a documented per-field budget. The same content appears in
several fields, and operation history encoding (`packages/durable/src/message-log.ts:33`) shrinks
storage but not the limit check: `putOperation` measures the expanded operation before the SQLite
layer packs it (`packages/durable/src/sqlite.ts:506`).

**Options.**

1. Keep per-field limits, document a derivation table ("prompt ≤ 1 MiB − history − request
   envelope") and expose the effective headroom. Cheap, but users must still do arithmetic.
2. Add a single admission check on the submission (prompt plus projected prompt) and separate,
   larger limits for model requests and tool results. Clearer semantics; needs new knobs and a
   migration story for existing deployments.
3. Measure packed/compressed payloads instead of expanded JSON. Would admit far more history, but
   makes the limit storage-dependent and hard to reason about, and does not help providers.
4. Raise defaults substantially (say 8 MiB) and rely on the HTTP body limit. Simple, increases
   SQLite write amplification and event size; does not fix the growth trap.

**Recommendation.** Option 1 now, Option 2 in the next minor: publish an "effective budget" table,
add `field` and `limit` to the error, and give `maxPayloadBytes` a per-field override map
(`prompt`, `operation`, `event`, `outcome`) with the single value as the fallback.

**Effort/risk.** S (docs + error metadata) / low. The per-field override is M / medium because it
changes the public runtime options type and error surface.

#### DUR-02 — The HTTP body limit is the real input ceiling

**Evidence:** `packages/server/src/durable.ts:75` (default `maxBodyBytes` 65,536),
`packages/server/src/durable.ts:116` (submit body read with that limit),
`packages/server/src/durable-http.ts:77` (bytes counted while reading), `:79` (413),
`packages/client/src/durable.ts:370` (client cancels the body without reading the message),
`docs/packages/durable.md:510` (docs mention the 64 KiB default but not that it is the binding
limit).

**Impact.** Through the documented bridge, any image larger than about 48 KiB binary (≈64 KiB
base64) is rejected with 413 before the runtime limit applies. Verified: a 70,000-character prompt
against the default handler returned 413 `{"error":"Durable request body is too large"}` while the
1 MiB payload limit was untouched. A browser client sees only
`DurableHttpError: Durable request failed with HTTP 413.` — no field, no size, no hint. Long
documents and PDF-derived text hit the same wall.

**Root cause.** The two limits were designed independently: the runtime limit bounds persistence,
the HTTP limit bounds request parsing. Their defaults are two orders of magnitude apart, and the
docs describe them side by side without stating which one wins for uploads.

**Options.**

1. Align defaults (for example `maxBodyBytes` derived from `maxPayloadBytes` plus envelope
   headroom). Fewer surprises; a host that forgets to configure it gets a large body limit.
2. Keep 64 KiB and document a required `maxBodyBytes` for multimodal use. Safe by default, but the
   documented quickstart still fails for images.
3. Add a two-step upload API (upload bytes to storage, submit a URL reference). Best for large
   media; significant new surface and storage lifecycle work.
4. Stream-parse JSON and reject on field overflow rather than raw bytes. More precise errors;
   more complex handler and no protection against decompression bombs.

**Recommendation.** Option 2 short term (document explicitly, add a startup warning when the body
limit is below a configured payload limit and an agent declares image/document input), then
Option 1 as the default once the two limits share configuration. Add the field name to the 413
body.

**Effort/risk.** S / low for documentation and a warning; M / medium for shared configuration.

#### DUR-03 — Growing session history traps the run in a non-terminal state

**Evidence:** `packages/durable/src/runtime.ts:671` (history is inherited into the run record),
`:681` (previous history plus previous outcome messages), `:689` (the same history is copied into
`input`), `packages/durable/src/limits.ts:55` (both fields are checked), `:64` (the write is
rejected), `packages/durable/src/runtime.ts:641` (a `DurableLimitError` outside `execute`'s own
try/catch becomes `needs_attention`), `:645` (`setStatus(..., "needs_attention")`),
`packages/durable/src/run.ts:52` (`result()` polls the run), `:57` and `:60` (only failed,
cancelled, or completed settle), `:66` (every other status waits), and
`packages/durable/src/run.ts:46` (the stream ends only on a terminal status).

**Impact.** Verified: with `maxPayloadBytes: 2000` and four 300-character turns, turn 5 never
starts. The run record stays at `history: 0` (the transaction rolls back), the status is
`needs_attention`, and the error is the generic payload message. `run.result()` was still waiting
after 20 s; `run.stream()` does not terminate; the HTTP SSE subscription stays open forever because
the run is not terminal. `retry()` is allowed (`packages/durable/src/runtime.ts:567`) and lands in
the same state. A new submission for the session inherits the same over-limit history and repeats
the cycle. `runtime.health()` stays `ready`, so supervision does not notice a stuck session.

**Root cause.** History inheritance happens in the same transaction that transitions
`queued` → `running` (`packages/durable/src/runtime.ts:667`), outside `execute`'s error handling.
The only handler for a limit error there is the scheduler's `needs_attention` catch. `needs_attention`
is designed for operator action, but no action exists: `blockedOperation` is unset, so
`resolveTool` is not applicable, and `retry` cannot change the inherited history.

**Options.**

1. Treat a limit error at execution start as terminal `failed` with a specific error code. At least
   `result()` settles and the UI can show a clear failure; the session still cannot continue.
2. Compact or truncate inherited history before admission, with a persisted checkpoint that records
   what was dropped. Preserves the session; changes what the model sees and needs a policy.
3. Refuse new submissions earlier: validate `projected history + prompt` at `submit` time and
   return a typed conflict. Prevents stuck runs but rejects work the runtime could have compacted.
4. Split canonical history out of the run record (store a history reference) so the run record is
   bounded. Fixes the trap fundamentally; large storage/schema change.
5. Raise the limit automatically when history grows. Hides the problem and unbounds storage.

**Recommendation.** Do (1) immediately as a safety fix (typed `DurableLimitError` with a
`phase: "admission"` / `field` marker and a terminal status), then (3) as an admission check, then
(2) behind an explicit compaction policy. (4) belongs on the roadmap, not in a patch.

**Effort/risk.** S / low for (1) and (3); L / high for (4).

#### DUR-04 — Retrying a payload-blocked run silently discards history

**Evidence:** `packages/durable/src/runtime.ts:671` (history inheritance is guarded by
`current.status === "queued"`), `:586` (`retry()` sets `pending`), `:669` (`pending` is accepted by
`execute`), `:710` (execution proceeds with the saved `input`, which is only the prompt),
`packages/durable/src/limits.ts:55` (the over-limit history was never committed).

**Impact.** Verified: after the turn-5 block in DUR-03, `retry()` completed the run and the model
request contained `["user"]` — only the new prompt, not the four previous turns. The next
submission then inherited the retried run's two-message history and completed normally
(`["user","assistant","user"]`). The conversation is silently truncated: no error, no warning, and
the earlier runs remain in the journal but are no longer on the session's continuation chain.
This is a correctness/data-integrity bug, not just a limit bug.

**Root cause.** History inheritance is tied to the `queued` transition, which normally happens once.
`retry` deliberately reuses a run record whose `history` was rolled back, so the second execution
takes the "already started" path. The invariant "a run record always contains the history it will
execute with" is not enforced.

**Options.**

1. Make `retry()` recompute inherited history from the session's latest settled run before
   re-execution (same code as the `queued` branch). Fixes the data loss; the retried run may fail
   again on the same limit, which is then an honest failure.
2. Persist the computed history (or a reference to it) before the `queued` → `running` transition,
   so a failed transition can be retried with the same input. Also fixes recovery determinism.
3. Refuse `retry()` unless the run has a persisted history snapshot. Simplest and safest; makes
   this class of run non-retryable, so the session needs a new submission after compaction.

**Recommendation.** (1) plus (2): compute and persist the history reference/idempotently before
execution, and make `retry` rebuild it if absent. Add a regression test asserting the request
history after a retry.

**Effort/risk.** M / medium: touches the execution start path and the retry contract, and needs a
schema-safe way to persist or recompute the inheritance.

#### DUR-05 — Oversized tool output and oversized outcomes have different recovery paths

**Evidence:** `packages/durable/src/execution.ts:250` (tool operation start),
`:262` (tool result is serialized), `:272` (a write failure becomes `DurableRecoveryError`),
`packages/durable/src/runtime.ts:739` (`blockedOperation` is set for recovery errors),
`:537` (`resolveTool` requires the blocked operation), `packages/durable/src/limits.ts:88`
(resolution writes are checked again), `packages/durable/src/runtime.ts:756` (other failures become
`failed`).

**Impact.** Verified: a 2,000-byte tool result under a 1,000-byte limit left the run in
`needs_attention` with `blockedOperation: "0:tool:1:call-1"`; the tool ran exactly once, and
`resolveTool` with a small reconciled output completed the run without re-running the tool. That is
the documented behaviour and it is sound. An oversized model outcome, by contrast, becomes
`failed`; `retry()` can only succeed after the limit is raised and the runtime restarted. Large
tool results that cannot be summarized to fit are therefore dead ends unless an operator raises the
limit. There is no automatic truncation, externalization, or content-reference support.

**Root cause.** Tool results are treated as recoverable effects, while model outcomes are treated as
run state; both use the same byte budget. There is no mechanism for "large result stored out of
line" and no distinction between "too large to persist" and "too large to send to the provider".

**Options.**

1. Keep the current model, document it, and add an operator runbook (raise the limit, restart,
   reconcile).
2. Add an opt-in result externalizer (store the full result in a blob store and persist a reference
   plus a bounded preview). Best UX; new storage contract and security surface.
3. Add automatic summarization of oversized tool results through the registered compactor.
   Reuses existing infrastructure; changes tool semantics and may lose fidelity.
4. Make tool byte budgets separate from run/outcome budgets. Simple, but large results still bloat
   the model request.

**Recommendation.** (1) now with a clear runbook; design (2) for the next minor, gated by a
`toolResults` policy on the registration. Do not summarize silently: a tool result is evidence.

**Effort/risk.** S / low for the runbook; L / medium-high for (2).

#### DUR-06 — 429 conflates unrelated failures and loses information in the client

**Evidence:** `packages/server/src/durable.ts:178` (every `DurableLimitError` becomes 429 with only
the message), `packages/durable/src/limits.ts:50` (pending-run limit), `:74` (pending-task limit),
`:91` (operation count), `:34` (payload limit) — all share the class; `packages/client/src/durable.ts:47`
(the error carries only a status), `:370` (the body is cancelled).

**Impact.** Verified: a payload rejection returned 429 with body
`{"error":"Durable payload byte limit exceeded."}` and no `Retry-After`; `DurableClient` surfaced
`Durable request failed with HTTP 429.` A caller cannot tell "try later" (capacity) from "this
request can never fit" (payload) without string matching, and the shipped client cannot even see
the string. Automatic retry policies will retry a permanently failing request; UIs cannot render a
useful message.

**Root cause.** A single error class for four different admission failures, mapped by HTTP status
only, combined with a client that deliberately discards response bodies.

**Options.**

1. Add `code` (`payload_limit`, `pending_limit`, `operation_limit`), `field`, `limit`, and
   `retryable` to the JSON body; surface a typed `DurableHttpError` with `code` and `details` in the
   client. Clear, backwards compatible for status-based callers.
2. Use distinct statuses (413 for payload, 429 for capacity, 409 for conflict). More RESTful but
   changes the documented contract.
3. Add `Retry-After` for capacity errors only. Complements (1), does not replace it.

**Recommendation.** (1) plus (3). Keep 429 for capacity, add 413 for payload at the HTTP layer
(DUR-02 already uses 413 for body size, so payload can share it), and extend `DurableHttpError`
without breaking `status`.

**Effort/risk.** S / low-medium: the client error type is public API and needs a changeset.

#### DUR-07 — Status events duplicate the outcome without a payload check

**Evidence:** `packages/durable/src/runtime.ts:728` (the whole outcome is assigned to the run),
`packages/durable/src/runtime.ts:808` (`setStatus` starts), `:824` (the whole outcome is embedded in
the event), `packages/durable/src/limits.ts:39` (only `model_delta` events are checked),
`packages/durable/src/sqlite.ts:517` (events are stored as JSON),
`packages/durable/src/runtime.ts:815` (status writes also call `putRun`), and
`packages/durable/src/limits.ts:64` (which stringifies seven fields twice).

**Impact.** A completed 1 MiB outcome is written once to the run record and a second time into the
`status` event (plus a third copy inside the `submitted` event if it is the prompt). `run.outcome`
also carries `continuation.state` for interaction outcomes (`packages/core/src/agent/interactions.ts:53`), which is
an arbitrary JSON object and is not separately bounded. Event table growth and WAL pressure follow
directly. The limit guard re-stringifies `history`, `input`, `outcome`, and four other fields on every
`putRun`; with a 1 MiB history that is several megabytes of transient JSON per status transition,
and `setStatus` writes twice. This is a performance and storage risk, not a correctness bug.

**Root cause.** The event model embeds snapshots for convenience, and the guard compares by
serialized value on every write instead of using a dirty flag or a stored length.

**Options.**

1. Emit a compact status event (status, error, ids) and let clients fetch the snapshot. Reduces
   duplication and event size; changes the event payload contract and the client mapping.
2. Keep the payload but apply the same payload check to every event type. Prevents unbounded rows;
   does not remove duplication.
3. Store the outcome once and reference it from events. Best storage outcome; schema change.
4. Cache serialized field sizes on the run record to avoid re-stringifying unchanged fields.
   Localized optimization; new derived state to keep consistent.

**Recommendation.** (1) for the next minor (status events are observability, not state), (4) as a
patch if profiling confirms the cost. Document that status events are not an API for reconstructing
outcomes.

**Effort/risk.** M / medium for (1) because consumers and tests rely on `event.data.outcome`.

### 2. `useChat` interoperability

#### DUR-10 — The two protocols have no overlap today

**Evidence:** `packages/client/src/types.ts:367` (`ClientStreamFrame` is a three-frame envelope),
`:398` (`ClientTransport.send` returns those frames), `:404` (the only transport method),
`packages/client/src/client-transport.ts:136` (frame sequence validation requires contiguous
`eventId`s), `packages/react/src/use-chat.ts:198` (the hook iterates frames), `:200` (it requires
`stream_start` to mark acceptance), `:207` (`stream_event` carries the protocol event), `:216`
(anything else must be `stream_end`), `packages/client/src/durable.ts:255` (durable's
`stream()` yields `DurableEvent`s), `packages/durable/src/types.ts:193` (the durable event list),
`docs/packages/durable.md:547` (the incompatibility is documented).

**Impact.** `useChat` cannot be pointed at durable at all: `DurableClient` has no `send()` and
`useChat` has no way to consume a `DurableEvent`. Passing a durable client through the
`transport` option is a type error; casting it results in a runtime failure on the first frame.
Consequently none of the `@anvia/react-ui` chat primitives (`ChatProvider`, thread, message,
composer, human-input panel) can be used with durable today.

**Root cause.** Two independently designed protocols: `anvia.client.v3` is a UI-oriented,
message/part-oriented protocol; durable is a run/operation-oriented journal protocol with a
different lifecycle and resume model. The docs treat this as intentional, and it is a reasonable
design split — but no adapter or bridge is shipped.

**Options.**

1. Client-side `ClientTransport` adapter (map durable events into client frames, hold the run/cursor
   in the adapter). No server or protocol changes; ships as an opt-in module; loses some fidelity
   (see DUR-12).
2. Server-side protocol bridge: an endpoint that accepts `ClientStreamRequest` and emits
   `anvia.client.v3` frames, holding durable IDs server-side. Hides durable internals and can
   reconcile client-sent history; new server surface, new state, more auth surface.
3. Teach `useChat` about durable runs directly (a second transport contract). Couples the generic
   React layer to durable and forks the UI event model; not recommended.
4. Keep them separate and document a manual `UseChatResult` implementation. Cheapest; leaves the
   user report unanswered.

**Recommendation.** (1) now, designed so it can be replaced by (2) without changing the React
surface. Compare in DUR-13.

**Effort/risk.** M / medium for (1); L / medium-high for (2).

#### DUR-11 — The request contract does not carry what durable needs

**Evidence:** `packages/client/src/types.ts:164` (`ClientStreamRequest` has only `messages` and
`interaction_response`), `:166` (a full core `Message[]`, no agent/session/request identity),
`:172` (an interaction response without a `runId`), `packages/react/src/use-chat.ts:256` (the hook
sends the whole UI history every turn), `:302` (interaction responses reuse the same transport
call), `:341` (`stop()` aborts the fetch and clears resume state), `packages/client/src/durable.ts:221`
(submission needs `agentId`, `sessionId`, `requestId` and a single `prompt`),
`packages/client/src/durable.ts:298` (respond needs `runId`), `packages/server/src/durable-http.ts:40`
(SSE cancellation detaches only the subscriber), `packages/durable/src/runtime.ts:330` (a second
submission into a busy session is a 409).

**Impact.** Four concrete gaps:

1. **Identity.** The transport must be constructed per chat with a fixed `agentId`, `sessionId`, and
   a request-id factory, because the hook's request has nowhere to put them. Switching sessions
   means replacing the transport, and `useChat` has no notion of "this transport now points at a
   different session".
2. **Prompt extraction.** The hook sends the full message array; durable accepts one prompt and owns
   history server-side. The adapter must take the last user message and drop the rest. If the client
   state diverges from the server (after `reset()`, after a reconnect, after a failed turn), the
   divergence is silent. `regenerate()` becomes a new run with a duplicate user turn because
   durable deduplicates only by `requestId`, not by conversation position.
3. **Interaction routing.** `respondToInteraction` provides only `interactionId` and the response.
   Durable's `respond` needs `runId`, which the hook never sees. The adapter must remember the run it
   last streamed and reject responses when it has none.
4. **Disconnect semantics.** `stop()` aborts the fetch. For durable that only closes the SSE
   subscription; the run keeps going (`docs/packages/durable.md:543`). The hook then clears its
   resume state, so the client forgets a run that is still executing. The next send hits 409
   "Session already has unfinished work", which the hook renders as a generic error. Durable's
   `cancel()` is a separate, explicit operation that the hook has no button for.

**Root cause.** The client contract assumes the server derives conversation state from the message
array and that aborting the request aborts the work. Durable assumes the opposite on both counts.

**Options.**

1. Adapter holds identity and the active run id, and maps `stop()` to "detach"; expose
   `cancelActiveRun()` and `reattach()` helpers alongside the adapter.
2. Extend `ClientStreamRequest` with optional `agentId`/`sessionId`/`requestId` and a `cancel`
   intent. Cleaner typing, but changes a public protocol type used by every transport and server.
3. Server bridge that owns identity and run mapping, so the client contract stays unchanged. Same
   trade-offs as DUR-10 option 2.
4. New durable-aware hook (`useDurableChat`) that speaks durable natively and exposes
   `result()`/`retry()`/`resolveTool()`. Best fidelity; duplicates `useChat` state handling and
   leaves `react-ui` primitives bound to the old controller type.

**Recommendation.** (1) for the adapter, plus a small `DurableChatController` wrapper exposing
`activeRunId`, `reattach`, `cancel`, `retry`, and `resolveTool` without changing `useChat`. Keep (2)
and (4) as follow-ups if the adapter proves too lossy.

**Effort/risk.** M / medium: `stop()` semantics and 409 handling are user-visible and need explicit
UX.

#### DUR-12 — Durable's event model lacks the identifiers the UI protocol requires

**Evidence:** `packages/durable/src/types.ts:193` (event types), `:195` (sequence, runId, createdAt,
type, data), `packages/durable/src/sqlite.ts:78` (sequence is a global autoincrement row id),
`packages/durable/src/execution.ts:222` (deltas wrap core generation events),
`packages/client/src/types.ts:325` (client interaction event), `:345` (client run_end with usage,
context usage, trace), `packages/react/src/use-chat.ts:144` (`run_end` status drives the waiting
state), `packages/client/src/reducer.ts:27` (`message_start` creates a UI message),
`:43` (`text_delta` appends to a part).

**Impact.** The adapter must synthesize a message id and part ids per model attempt, emit
`message_start`/`text_start`, translate `model_delta.data.event` variants (`text_delta`,
`reasoning_delta`, `tool_call_delta`, `tool_call`, `source`), turn `model_completed` into
`text_end`/`message_end` with usage, turn `tool_started`/`tool_completed` into
`tool_call_end`/`tool_result`, and turn the final `status` event into `interaction` (if waiting) or
`run_end`. Context usage is not computed by durable; it can only be taken from the outcome if the
core provided it. Durable sequences are global across runs, so they are not contiguous per stream:
the standard `validateFrameSequence` (`packages/client/src/client-transport.ts:163`) would reject
them. The adapter must not use that validator, or must expose local event ids and keep the durable
cursor separately (the hook's resume state only stores `streamId` + `after`).

**Root cause.** Durable events describe journal transitions; the UI protocol describes rendering
intent. The mapping is inherently lossy in one direction (rendering detail must be invented) and
lossless in the other (every journal event can be represented or ignored).

**Options.**

1. Synthesize deterministic ids (`${runId}:${operationId}:${attemptId}`) and use the durable
   sequence as `eventId`. Stable across reconnects; relies on the global sequence being the cursor
   (it is what `stream({ after })` expects).
2. Use locally assigned contiguous ids and keep a separate durable cursor in adapter state.
   Satisfies the standard validator; resume state must be extended outside the hook.
3. Add a server-side projection that emits UI frames. Moves the synthesis server-side and makes ids
   authoritative for all clients.

**Recommendation.** (1) for the adapter, with a comment explaining why the standard frame validator
is bypassed; extend `DurableClient` with a `streamFrames` helper if more than one consumer needs it.
Revisit (3) if a server bridge is built.

**Effort/risk.** M / low-medium: pure mapping, but every event variant needs a test.

#### Design D-13 — Adapter design: client-side transport versus server-side bridge

This section is the concrete design requested for making `@anvia/react-ui` work with durable. It is
a design only; nothing here was implemented.

**Common mapping (both options).**

| UI protocol input                         | Durable operation                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request.type === "messages"`             | Take the last `user` message from `request.messages` (attachments already converted by `packages/client/src/messages.ts:44`), submit `{agentId, sessionId, requestId: uuid(), prompt: userMessage}` with `enqueue: true`, remember `run.id`, stream from cursor 0. |
| `request.type === "interaction_response"` | `client.respond(activeRunId, interactionId, response)`, then stream `activeRunId` from the last applied sequence. Error if no active run.                                                                                                                          |
| `send({ resume })`                        | `stream(resume.streamId, { after: resume.after })`; `streamId` is the durable `runId`.                                                                                                                                                                             |
| `send({ abortSignal })`                   | Pass to `DurableClient.stream`; abort detaches only.                                                                                                                                                                                                               |
| `stop()`                                  | Detach and keep `activeRunId`; expose a separate `cancel()` for `client.cancel(runId)`.                                                                                                                                                                            |
| new message while a run is active         | `enqueue: true` returns a queued run; the adapter streams it separately or reports "queued" until the previous run settles.                                                                                                                                        |
| 409 session busy                          | Surface a typed `DurableBusyError` with the active run id and offer `reattach()`.                                                                                                                                                                                  |

**Event mapping.**

| Durable event                                        | Client frames                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `submitted`, first `status`                          | `run_start` (`source: "agent"`), `message_start` for the assistant placeholder.                            |
| `model_started`                                      | `turn_start`, `generation_start`, `message_start` for the turn's message.                                  |
| `model_delta` (text/reasoning/tool call)             | `text_start` + `text_delta`, `reasoning_start` + `reasoning_delta`, `tool_call_start` + `tool_call_delta`. |
| `model_attempt_started` for an existing operation    | `message_reset` for that message (discard partial attempt).                                                |
| `model_attempt_failed`                               | `error` event; the run may retry (`retry_wait`) so the adapter keeps the message.                          |
| `model_completed`                                    | `tool_call_end` for tool calls, `text_end`, `message_end` with `usage`; the response is the checkpoint.    |
| `tool_started`                                       | `tool_call_end` with the persisted call input; `tool_result` is emitted on completion.                     |
| `tool_completed`                                     | `tool_result` with output or error.                                                                        |
| `compaction_completed`                               | `memory_compaction` (payload matches `MemoryCompactionInfo`).                                              |
| `steering_queued` / `steering_applied`               | `data` events (transient) or ignored.                                                                      |
| final `status` with `outcome.type === "interaction"` | `interaction` event with `outcome.interaction`, then `run_end` with status `suspended`.                    |
| final `status` `completed`                           | `run_end` with `text`, `output`, `usage`, `trace`, `contextUsage` when present.                            |
| final `status` `failed`                              | `error` event with a normalized `ClientStreamError`, then `run_end` status `error`.                        |
| `needs_attention`                                    | `error` with a retryable marker and the blocked operation id in `details`; `run_end` status `error`.       |
| `cancelled`                                          | `run_end` status `cancelled`.                                                                              |

**Resume and replay.** Durable replays from any committed sequence; a fresh snapshot plus
`stream({ after: cursor })` is the documented recovery path. The adapter uses the durable sequence
as `eventId`, so `useChat`'s persisted `{ streamId, after }` is directly the durable resume cursor.
A reconnect therefore works if the adapter is constructed with the same `endpoint`, `agentId`, and
`sessionId`; the `streamId` is the run id. The one gap is that `useChat`'s `resume` state also stores
the original request, which the adapter can ignore for streaming but needs for interaction
responses; the active run id must be recoverable from `streamId`, which it is.

**Disconnect semantics.** A client disconnect must never cancel the run. Durable already guarantees
this: `durableEventsResponse` aborts only its detached controller (`packages/server/src/durable-http.ts:40`),
and `run.stream()` closing does not touch execution (`packages/durable/src/run.ts:31`). The adapter
must not translate `stop()` into `cancel()`. The UI should show "running in background" and offer
"reconnect" (stream from the stored cursor) and "cancel" (explicit, confirmed).

**UI primitives unlocked.** With the adapter, the existing `ChatProvider`/`Thread`/`Message`/
`Composer` primitives work from the `UseChatResult` shape, including streaming text and tool parts;
`useHumanInput` and `HumanInputPanel`/`Approvals`/`Questions` work because durable surfaces
`tool-approval` and `tool-question` interactions (`packages/react-ui/src/contexts/chat.tsx:51`);
`Attachment`/`Image` parts work because durable accepts structured user prompts with media; the
`waiting` status is produced by `run_end: suspended`; `error` and `runUsage` work from the mapped
events. `thread-list` does not: it is a client-side record list, whereas durable sessions are server
data (`runtime.listRuns`) and need a separate loader. `regenerate` and `reset` remain approximate for
the reasons in DUR-11.

**Client-side adapter (recommended for now).** A module in `@anvia/client` (for example
`@anvia/client/durable-chat`) exporting `createDurableChatTransport({ client, agentId, sessionId,
requestId?, enqueue? })` that returns a `ClientTransport<ClientStreamRequest>`. Pros: no server or
protocol change; reuses validated `DurableClient` events; type-safe; ships quickly; can be tested
with the existing fake-fetch pattern. Cons: durable ids and auth stay in the browser; the adapter
must synthesize UI protocol detail; client-sent history is discarded, so divergence is invisible;
409 recovery and interaction routing need adapter state.

**Server-side bridge.** A handler that accepts `anvia.client.v3` requests and emits frames, keeping a
`streamId → runId` map, translating events, and optionally reconciling client history with durable
history. Pros: hides durable ids; one authoritative mapping for all clients; can add history
reconciliation, run attach, and fan-out; keeps the React layer free of durable types; can return
proper 413/429 errors in the client protocol. Cons: a new stateful HTTP surface to design, secure,
and test; streaming proxy complexity (SSE framing, backpressure, abort); duplicates what
`DurableClient` already validates; requires a durable `messages` input or a diff-based reconciliation
to genuinely use the sent history; more moving parts for an experimental package.

**Recommendation.** Ship the client-side adapter first (M effort, low deployment risk), with the
mapping isolated in a pure module so a server bridge can reuse it later. Build the server bridge when
one of these becomes true: history reconciliation is required, multiple clients must share a run, or
durable ids must not reach the browser. Do not build a durable-specific `useChat`.

### 3. Agent feature parity

The full matrix, evidence, and phased design live in
[`durable-agent-parity.md`](./durable-agent-parity.md). Summary of the findings:

#### DUR-20 — Eight `AgentOptions` feature groups are rejected at registration

**Evidence:** `packages/durable/src/registration.ts:26` (the combined rejection condition),
`:27` (memory), `:28` (lifecycle), `:29` (middlewares), `:30` (guardrails), `:31` (context),
`:32` (MCP servers), `:33` (provider tools), `:34` (tool indexes), `:37` (the combined message);
surface in `packages/core/src/agent/types.ts:36` (`AgentOptions`), `:46` (context), `:48` (MCP),
`:57` (lifecycle), `:60` (guardrails), `:61` (middlewares), `:62` (memory).

**Impact.** Any agent built with one of these features throws at `DurableRuntime.open()` or
`registerAgents()`, even if the feature is static and deterministic (static `Document` context, a
pure middleware that only logs). The error lists all features at once, so callers cannot tell which
one tripped. Migration requires rewriting the agent or dropping durable.

**Root cause.** These features introduce effects, external reads, or request mutation during a run.
Without their own persistence boundaries, replay could repeat effects or change requests, which
breaks the checkpoint model. Rejection is the safe default, but it is coarse: context documents are
not all dynamic, middleware is not always effectful, and lifecycle hooks can be observational.

**Options.** (a) keep rejection and improve diagnostics; (b) admit the deterministic subset
(static documents, read-only observers) behind explicit markers; (c) implement general checkpointing
for each feature. See the parity document for the phased plan.

**Recommendation.** (a) now, (b) for static `Document` context and observational lifecycle in the
next minor, (c) only for features with demonstrated demand.

**Effort/risk.** S / low for diagnostics; M-L per feature for (b)/(c).

#### DUR-21 — Silent partial support is more dangerous than rejection

**Evidence:** `packages/durable/src/runtime.ts:717` (`retries: false` overrides the agent's retry
setting; core reads it at `packages/core/src/agent/run-types.ts:86`), `:712` (only input, trace,
abort signal, and retries are passed; per-run `maxTurns`, `lifecycle`, `guardrails`,
`toolConcurrency`, `middlewares`, `controls` are never set), `packages/core/src/agent/run-types.ts:79`
(the full per-run settings surface), `packages/durable/src/registration.ts:47` (registration accepts
compaction, tool recovery, model retry, stream), `packages/durable/src/schema.ts:31` (outcome output
must be a JSON value), `packages/durable/src/registration.ts:18` (stream requires a streaming model).

**Impact.** An application that configured `new Agent({ retries: { maxAttempts: 3 } })` gets **no
retries** under durable, with no error: `retry: false` is passed unconditionally. Per-run controls
(`maxTurns`, `guardrails`, `lifecycle`, `toolConcurrency`, `middlewares`, `controls`) cannot be set
at all; `maxTurns` is frozen at registration
(`packages/durable/src/runtime.ts:337` via the run record created in
`packages/durable/src/run-record.ts:22`). Structured output that is not JSON (a `Date`, a class
instance) fails at persist time rather than at registration. `Agent.skills` is accepted and flattened
into static instructions/tools (`packages/core/src/agent/resolve-options.ts:45`), which is fine but
undocumented in the durable guide.

**Root cause.** Registration validates a subset of options and reuses core's runtime, but the run
options are assembled by durable and silently omit or override parts of the core contract.

**Options.** (a) reject any agent whose `retries`/unsupported options are set, with a clear message;
(b) map `retries` to `modelRetry` automatically; (c) add a per-run override API on submission;
(d) document the overrides and add a startup compatibility report.

**Recommendation.** (a) plus (d) now: reject or warn on `retries`, and print a compatibility summary
at open. Add (c) for `maxTurns` only, since it is the most requested and the run record already
stores the value.

**Effort/risk.** S / low for (a) and (d); M / medium for (c).

#### DUR-22 — Compaction is real but narrower than `Agent.memory` compaction

**Evidence:** `packages/durable/src/types.ts:14` (compaction policy), `:21` (compaction options),
`:41` (the registration surface), `packages/durable/src/compaction.ts:56` (projection from canonical history),
`:74` (the compaction operation input includes the prefix), `:167` (the run input is replaced with the
projection), `packages/durable/src/loop-context.ts:32` (loop compaction is gated on the captured
flag), `packages/durable/README.md:255` (compaction does not bypass payload limits),
`docs/packages/durable.md:558` (stale claim that steering is unsupported, adjacent to the current
scope list).

**Impact.** Durable compaction reduces the model-facing projection and records a summary checkpoint,
but **does not reduce canonical history**, so it does not delay or avoid the history payload wall in
DUR-03. It is configured only at registration, cannot be triggered manually, and its policy is
frozen per submission. `Agent.memory` (store, save policy, conflict retries, memory compaction) is
rejected, so applications must port their compaction logic to a `MemoryCompactor`.

**Root cause.** Compaction was designed to protect the model window, not the journal budget. The
two budgets are independent, and only the model-window side has a compaction mechanism.

**Options.** (a) document the distinction and add a journal-budget policy (drop/rewrite canonical
history with an auditable checkpoint); (b) add manual compaction; (c) admit `Agent.memory` with
checkpointed save policies. See the parity document.

**Recommendation.** (a) in the next minor; (b) as a small API addition. (c) only after the memory
store contract has a durable transaction boundary.

**Effort/risk.** M / medium for (a); L / high for (c).

### 4. Cross-cutting findings

#### DUR-30 — Documentation contradicts the code and itself

**Evidence:** `docs/packages/durable.md:298` says the current schema is 7;
`docs/packages/durable.md:569` says schema 9, and `packages/durable/README.md:200` also says 9.
`docs/packages/durable.md:558` says "Mid-run steering is not supported" while the same document
documents steering (`docs/packages/durable.md:440`) and the runtime implements it
(`packages/client/src/durable.ts:281`). `docs/packages/durable.md:559` lists supported features but
omits steering, streaming, compaction, `modelRetry`, tasks, goals, and graphs.
`docs/packages/durable-operations.md:65` mentions the independent `maxBodyBytes` limit without
stating that its default is far below the payload default; `docs/packages/durable.md:510` states the
64 KiB default without explaining the multimodal consequence.

**Impact.** Users cannot tell which schema their database is on or which features are actually
available; a reader could reasonably conclude steering is unsupported while the runtime accepts it,
or plan a 1 MiB upload that the default bridge rejects at 64 KiB.

**Root cause.** Docs are updated per feature but not reconciled as a whole; the "current scope" list
predates steering and streaming.

**Options.** (a) a docs pass that fixes the schema number, removes the stale steering bullet, and
adds a limits table; (b) generate the feature list from code; (c) add a docs test that greps for
known stale phrases. (a) is sufficient; (c) is a cheap guard.

**Recommendation.** (a) plus a note in the parity document that this review supersedes the stale
list. Add the limits table to the operations guide.

**Effort/risk.** S / low.

#### DUR-31 — Test coverage misses the paths that matter for this review

**Evidence:** `packages/durable/test/multimodal.test.ts:177` (payload quota for an inline image at
submit), `packages/durable/test/streaming.test.ts:408` (oversized delta fails without provider
retry), `packages/durable/test/hardening.test.ts:147` (oversized effect blocks for reconciliation),
`packages/server/test/durable.test.ts:181` (413 for a small body limit). There is no test for
history growth, retry-after-block history loss, `result()` on `needs_attention`, HTTP body limit vs
payload limit, or the client's error body.

**Impact.** DUR-03 and DUR-04 passed a 239-test suite, including recovery and hardening tests. The
suite proves journal correctness but not boundary semantics.

**Root cause.** Limit tests use tiny limits on a single run; none exercises a multi-turn session or
the retry transition.

**Options.** Add targeted regression tests (the recommendation) or a property test over random
turn sizes and limits. The former is enough; the latter is a nice follow-up for the admission
matrix.

**Recommendation.** Add the six tests listed in the P0 plan below; they are deterministic and fast.

**Effort/risk.** S / low.

#### DUR-32 — Limit failures are not observable as such

**Evidence:** `packages/durable/src/metrics.ts:5` (status counts only), `:8` and `:9` (operation
and event totals), `packages/durable/src/runtime.ts:644` (the limit error is stored as free text),
`packages/durable/src/runtime.ts:736` (other failures likewise), `packages/durable/src/types.ts:193`
(no limit event type).

**Impact.** Operators see `needs_attention` or `failed` counts and a message string, but cannot
alert on "payload limit rejections" or graph them by field. The stuck-session case in DUR-03 looks
like ordinary blocked work.

**Root cause.** No error taxonomy at the boundary; metrics are status aggregates.

**Options.** (a) add `durable_limit_rejections_total{kind,field}` to metrics; (b) emit a
`limit_exceeded` event; (c) both. (a) is enough for alerting; (b) helps the UI explain the failure.

**Recommendation.** (a) now, (b) with the error-code work in DUR-06.

**Effort/risk.** S / low.

#### DUR-33 — Error mapping depends on a single module instance

**Evidence:** `packages/server/src/durable.ts:178` (`instanceof DurableLimitError`),
`packages/durable/src/errors.ts:39` (the class), `packages/server/src/durable.ts:184` (any other
error becomes 500).

**Impact.** In a duplicated-install or mixed module-instance setup (two copies of `@anvia/durable`,
one loaded from source and one from `dist`), a limit error is not recognised and becomes a 500.
This was observed in the scratch harness when the runtime was imported from source and the handler
from `dist`; it is not a bug in normal single-instance deployments, but it is a realistic hazard for
monorepo consumers, bundlers, and version-mismatched hosts.

**Root cause.** Class identity is used as the error discriminant across package boundaries.

**Options.** (a) add a stable `code` property and check `code` (or use `Symbol.for`); (b) document
the single-instance requirement; (c) both.

**Recommendation.** (a) plus (b): give every durable error a `code` and map on the code, falling
back to `instanceof`.

**Effort/risk.** S / low.

## Verification notes

- The scratch tests used `limits: { maxPayloadBytes: 2000 }` with four 300-character assistant
  turns. The fifth turn parked at `needs_attention`; `result()` was still pending after 300 ms in the
  focused run and after 20 s in the first, unfixed attempt. `retry()` then completed with a request
  containing only the new user message.
- A tool returning 2,000 characters under a 1,000-byte limit produced
  `blockedOperation: "0:tool:1:call-1"`; `resolveTool` with `{type:"text", value:"ok"}` completed the
  run and the tool was called once.
- A 700-character prompt under a 1,000-byte limit failed the run with
  `Durable payload byte limit exceeded.` before any model call, because the model operation request
  includes the prompt plus its envelope.
- Through `createDurableHandler` with defaults, a 70,000-character prompt returned 413; with
  `maxBodyBytes: 1_048_576` and `maxPayloadBytes: 1_000`, a 2,000-character prompt returned 429 with
  body `{"error":"Durable payload byte limit exceeded."}` and no `Retry-After`; `DurableClient`
  exposed only `DurableHttpError` with status 429.
- All scratch files were deleted. `git status` before the review commit contained only the two
  review documents and the checker script.

## Reproduction sketch

The scaled-limit reproduction (not committed):

```ts
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(":memory:"),
  agents: [
    {
      agent: makeAgent(async () => response([{ type: "text", text: "a".repeat(300) }])),
      version: "1",
    },
  ],
  limits: { maxPayloadBytes: 2000 },
});
for (let turn = 1; turn <= 5; turn += 1) {
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "s",
    requestId: `r${turn}`,
    prompt: `turn ${turn}`,
  });
  // turn 5: status is needs_attention, result() never settles
}
```

The HTTP reproduction uses `createDurableHandler({ runtime, authorize })` and a `DurableClient`
whose `fetch` calls the handler, exactly like `packages/server/test/durable.test.ts:36`.

## Prioritized plan

Ordering is by user impact and dependency. Each item lists the test strategy and the changeset /
versioning implication. No item below was implemented; this is the plan the next session should
follow.

### P0 — data loss and stuck sessions

1. **DUR-03/DUR-04: make admission limits honest and stop losing history.**
   - Emit a terminal `failed` (or a dedicated `limit_blocked` status handled as terminal) when a run
     cannot start because its inherited history exceeds the payload limit; include field and limit.
   - Recompute inherited history in `retry()` (or persist a history reference before execution) so a
     retry never runs with less context than the original attempt.
   - Tests: (a) multi-turn session crosses the limit and `result()` settles; (b) retry of that run
     either fails with the same limit or executes with the full history — never a shorter request;
     (c) a new submission after the failure reports the same typed error. Use the scaled-limit
     pattern from this review (limit 2,000, four 300-character turns).
   - Changeset: `@anvia/durable` **minor** (`0.13.0`) because the status/error contract and retry
     behaviour change; `@anvia/client` and `@anvia/server` **patch** if error types are extended.
     `@anvia/durable` is pre-1.0 and experimental, so a minor bump is the honest signal; no major.

2. **DUR-02/DUR-01: align admission and transport limits.**
   - Document the effective budget, add the field name to the 413/429 body, and warn at startup when
     `maxBodyBytes` is below `maxPayloadBytes` and an agent accepts images/documents.
   - Tests: 413 for a body over `maxBodyBytes`, 429/413 for a prompt over `maxPayloadBytes` with a
     raised body limit, and a multimodal prompt that fits the body but not the payload.
   - Changeset: `@anvia/server` **patch** (error body), `@anvia/durable` **patch** (error metadata).

3. **DUR-31: regression tests before the fixes land.**
   - Add the six tests (growth, retry history, terminal admission, 413 vs 429, client error body,
     `needs_attention` result/stream) to `packages/durable/test/` and `packages/server/test/`.
   - Changeset: none (tests only).

### P1 — interop and parity gaps that block adoption

4. **DUR-10/DUR-11/DUR-12: ship the client-side durable chat adapter.**
   - New opt-in module under `@anvia/client` (for example `@anvia/client/durable-chat`) plus a pure
     mapping module and tests against a fake `DurableClient` stream. Document `stop()` vs `cancel()`,
     409 recovery, and the discarded client history.
   - Tests: mapping table cases, reconnect from a stored sequence, interaction response routing,
     disconnect does not cancel (assert the fake run is still active), busy-session error.
   - Changeset: `@anvia/client` **minor** (new entry point); no React change needed, so
     `@anvia/react-ui` stays untouched. If a `DurableChatController` wrapper is added to `@anvia/react`,
     that is a **minor** there too.

5. **DUR-20/DUR-21: make partial support explicit.**
   - Reject `retries` (or map it to `modelRetry`), and log a compatibility summary at `open()` listing
     ignored/rejected agent options. Add `maxTurns` per submission if it is cheap (the run record
     already stores `maxModelTurns`).
   - Tests: registration rejects `retries` with a targeted message; an agent with static `Document`
     context still rejects with a message naming `context`; `skills` remains accepted and documented.
   - Changeset: `@anvia/durable` **minor** if `retries` starts throwing (behaviour change), otherwise
     **patch** for diagnostics.

6. **DUR-06/DUR-33: error taxonomy.**
   - `code`, `field`, `limit`, `retryable` on limit errors; 413 for payload, 429 for capacity;
     `Retry-After` for capacity; `DurableHttpError` exposes `code` and `details`; map by `code`.
   - Tests: status and body for each limit kind; client parses the code; duplicated class instance
     still maps (simulate with a structurally identical error).
   - Changeset: `@anvia/durable` **minor** (error shape), `@anvia/client` **minor** (error type),
     `@anvia/server` **patch**.

### P2 — durability, docs, and roadmap

7. **DUR-07: compact status events and avoid re-stringifying unchanged fields.** Tests: event sizes
   stay bounded for a large outcome; `putRun` does not change event contents. Changeset:
   `@anvia/durable` **minor** (event payload change).

8. **DUR-22: journal-budget compaction and manual compaction.** Tests: projected input shrinks,
   canonical history is unchanged, payload wall moves, checkpoint audit is correct. Changeset:
   `@anvia/durable` **minor**.

9. **DUR-30/DUR-32: docs and metrics pass.** Fix schema 7 → 9, remove the stale steering bullet,
   add the limits table, add limit counters. Changeset: `@anvia/durable` **patch**; docs only
   otherwise.

10. **DUR-05: large tool result externalization.** Design doc first; implementation only after the
    storage contract is agreed. Changeset: `@anvia/durable` **minor** when it lands.

### Test strategy (applies to all items)

- Keep the existing 239 tests green; add targeted tests next to the code they cover.
- Prefer tiny limits (1,000–2,000 bytes) and short outputs for speed; assert on status, error code,
  and the model request history, not on timing.
- Use the fake `makeAgent`/`SqliteDurableStore(":memory:")` pattern already in
  `packages/durable/test/helpers.ts`; use the `createDurableHandler` + fake `fetch` pattern from
  `packages/server/test/durable.test.ts:36` for HTTP.
- Add one adapter test per event mapping row and one reconnect test; no browser required.
- Do not weaken existing recovery tests; run `pnpm --filter @anvia/durable test` and
  `pnpm --filter @anvia/server test` after each item.

### Changeset and versioning implications

`@anvia/durable` is 0.12.2 and explicitly experimental (`packages/durable/README.md:7`). Under the
repository rules, only patch/minor bumps are allowed. The P0 fixes change observable behaviour
(status of a blocked run, retry context) and should be a **minor** (`0.13.0`) with a CHANGELOG entry
that says so plainly; the test-only item needs no changeset. Error-shape additions are **minor** for
the packages that expose new types; pure message/status additions are **patch**. No changeset is
included in this review commit because the goal forbids touching `.changeset/`.
