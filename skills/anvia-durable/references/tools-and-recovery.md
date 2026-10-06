# Tools, effects, approvals, and recovery

## Two journal boundaries

A registered agent's static local tools execute through Anvia's durable model/tool journal.
Business code inside a custom task executes through `ctx.effect()`. Choose the boundary that
owns the work; an arbitrary function call, nested `agent.generate()`, or `fetch()` outside it
has no independent durable checkpoint.

Both commit an intent before the callback and a JSON result after it settles. Completed results
are reused. The uncertain interval is external success followed by a crash before result commit.
Choose a policy for that interval, not based on whether the callback returns a Promise:

| Policy             | Interrupted intent                | Suitable use                                            |
| ------------------ | --------------------------------- | ------------------------------------------------------- |
| `manual` (default) | Stop for reconciliation           | External mutations without reliable deduplication       |
| `safe`             | Repeat the callback               | Pure computation or reads where repeating is acceptable |
| `idempotent`       | Repeat with the same operation ID | A service that actually deduplicates the supplied key   |

Reads may have billing/rate-limit consequences or return changed data; decide whether repetition
is acceptable. Do not switch a started manual operation to `safe` to force progress. Saved recovery
policy and inputs govern recovery. A new operation ID is not a retry of the same external effect.

## Static agent tool with service-enforced idempotency

This factory receives an application-owned service client. Its credentials, authorization, and
external implementation are outside the durable engine. Configure the matching recovery policy
when registering the agent that owns this tool.

```ts
import { createTool } from "@anvia/core/tool";
import { z } from "zod";

type TicketService = {
  create(input: {
    title: string;
    idempotencyKey: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ ticketId: string }>;
};

export function createTicketTool(tickets: TicketService) {
  return createTool({
    name: "create_ticket",
    description: "Create a ticket for the user's requested work.",
    inputSchema: z.object({ title: z.string().min(1) }),
    outputSchema: z.object({ ticketId: z.string() }),
    requiresApproval: true, // Choose approval requirements from the application's policy.
    execute: async ({ title }, context) => {
      if (context.operationId === undefined)
        throw new Error("This tool requires durable execution with an operation ID.");
      return tickets.create({
        title,
        idempotencyKey: context.operationId,
        signal: context.abortSignal,
      });
    },
  });
}
```

Create the agent with `tools: [createTicketTool(tickets)]`, then register it with
`{ agent, version: "v1", toolRecovery: { create_ticket: "idempotent" } }`.
Use `manual` if the service does not enforce idempotency. Keep tool input/output schemas,
definitions, and approval predicates pure and compatible across recovery. Output parsing can
fail after a mutation succeeded, so the service receipt remains the authoritative external fact.

`context.operationId` is the complete stable external ID, combining run ID and checkpoint key.
A snapshot's `blockedOperation` and an event's `data.operationId` are run-local checkpoint keys
used for reconciliation, not the complete service idempotency key. Persist or log only the
necessary non-sensitive identifiers according to application policy.

## External work in custom tasks

Inside a task phase, with an application service client `tickets`:

```ts
const receipt = await ctx.effect(
  "create-ticket", // stable for this logical action across every replay of this task
  { title: ctx.input.title }, // include all arguments that determine the external action
  async (operationId, signal) =>
    tickets.create({ title: ctx.input.title, idempotencyKey: operationId, signal }),
  "idempotent",
);
```

Keys are scoped to the task's entire lifetime. Use a persisted item/iteration key for multiple
actions; use the same key only for the same action. Include action-relevant arguments in the
saved input. The engine detects changed saved input/policy. Concurrent use of one key is rejected.
Await all effects before returning a transition; fire-and-forget work can escape ownership and
is rejected when tracked effects remain unsettled. Persist business continuation state in the
returned checkpoint, not in mutable globals or a closure that must survive process death.

An ordinary effect callback exception fails the phase unless the handler handles it. That does
not prove the external operation failed. A non-JSON or oversized effect result instead blocks
for reconciliation because the callback may already have succeeded. Task terminal failures are
immutable: there is no general `retryFailedTask()` or automatic compensating transaction.

## Approvals and questions

A durable agent awaiting an interaction has `status: "waiting"` and an interaction outcome.
Obtain and authorize the caller's real decision, then use the run handle:

```ts
const run = await runtime.getRun(agentRunId);
const { run: saved } = await run.snapshot();
if (saved.status === "waiting" && saved.outcome?.type === "interaction") {
  const interaction = saved.outcome.interaction;
  if (interaction.type === "tool-approval") {
    await run.respond(interaction.id, {
      type: "tool-approval",
      approved: authorizedDecision.approved,
    });
  }
}
```

For an owned subagent, get `agentRunId` from its task record. Do not call `agent.resume()`
directly on the saved continuation: `run.respond()` must persist the response and continuation
transition. Identical response delivery is idempotent; conflicting answers fail. Questions use
the core `AgentInteractionResponse` type matching that question; inspect its public types rather
than inventing a response shape. Restarting, streaming, or awaiting `result()` never approves work.

Custom-task `signal()` is a separate workflow protocol. Use it for a task's review/wait state,
not as a substitute for resolving an agent's tool-approval interaction.

## Operator recovery

First inspect the snapshot and actual external service result. Limit administrative access:
operation inputs/results and task checkpoints may contain private data. After verifying a
blocked tool's receipt, reconcile with a `ToolResultOutput`:

```ts
await run.resolveTool(blockedOperationKey, {
  type: "json",
  value: { ticketId: verifiedTicketId },
});
```

For a custom-task effect, supply its verified raw JSON result instead:

```ts
await task.resolveEffect(effectKey, { ticketId: verifiedTicketId });
```

These APIs accept the matching started operation on a `needs_attention` execution; they are
not arbitrary result-editing APIs. They persist the result and resume work. Never manufacture
a receipt, mark success just to unblock a parent, or issue another mutation to guess what happened.
If the real result remains uncertain, keep the work blocked and escalate to the authorized operator.

| Situation                                            | Recovery                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `manual` tool/effect with uncertain intent           | Verify externally, then resolve the matching operation                              |
| Missing/incompatible agent version                   | Restore compatible registration and use permitted `run.retry()`                     |
| Custom task code/checkpoint mismatch                 | Restore compatible definition or supply a pure migration, then `task.retry()`       |
| Custom-task quota block                              | Raise the appropriate limit, reopen if needed, then retry the same task             |
| Failed root agent run                                | `run.retry()` if session/ownership fences permit; completed operations are retained |
| Terminal custom task or consumed owned-agent outcome | New authorized business attempt after auditing prior effects                        |
| Fatal storage error                                  | Stop admission; close, repair storage, restart/reopen, then resume saved work       |

A failed/blocked run cannot be retried after later session work has started. An owned agent whose
child outcome has been decided cannot be independently retried. A storage failure poisons the
whole runtime even if application code catches its immediate error; ordinary handler retries
cannot make that owner usable again. There is no exactly-once external-effect guarantee.
