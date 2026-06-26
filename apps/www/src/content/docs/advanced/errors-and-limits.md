---
title: Errors and limits
description: Handle cancellation, max turns, tool approvals, and model limits.
section: advanced
sidebar:
  group: Production architecture
  order: 9
---

Production runners should map known Anvia errors and provider failures into product-safe responses. Do that at the runner boundary, not inside prompt text.

## Common Runtime Failures

| Failure | Typical cause | Production response |
| --- | --- | --- |
| `MaxTurnsError` | the model-tool loop exceeded the configured turn limit | return a retryable or escalation response |
| `PromptCancelledError` | a hook cancelled the run | return the hook reason when safe |
| `ToolApprovalRequiredError` | a sensitive tool needs human approval | create or resume an approval workflow |
| capability error | model does not support requested tools, streaming, schema, or content | fail fast and use a compatible model |
| tool error | application service failed or rejected input | map to domain error, log safely |
| provider error | upstream timeout, rate limit, auth, or bad request | retry only when safe and bounded |

## Turn Limits

Set a default max turn count for every production agent:

```ts
const agent = new AgentBuilder("support", model)
  .instructions("Use tools only when needed.")
  .defaultMaxTurns(3)
  .build();
```

Use lower request-specific limits for latency-sensitive paths:

```ts
await agent.prompt(input).maxTurns(2).send();
```

If the agent regularly hits the limit, improve instructions, tool descriptions, or tool results before increasing the limit. Higher limits increase latency and cost, and can hide looping behavior that should be fixed.

## Cancellation And Hooks

Hooks can stop unsafe or out-of-policy runs:

```ts
import { createHook } from "@anvia/core";

function createEnvironmentGuardrail(environment: string) {
  return createHook({
    onRunStart({ run }) {
      if (environment === "production-disabled") {
        return run.cancel("This workflow is disabled.");
      }
    },
  });
}
```

Hook callbacks receive runtime state and a `run` controller. Put application state such as deployment environment, feature flags, or request policy in the closure that creates the hook.

Use cancellation for policy decisions and known unsafe states. Use ordinary thrown errors for infrastructure failures. Keep cancellation reasons safe enough to show to operators or users if the runner returns them.

## Tool Errors

Tools are application code. They can fail because records are missing, permissions are denied, services are unavailable, or side effects were rejected.

Validate tool input with schemas. Enforce permissions in the tool or service. Avoid leaking private service errors into model-readable output. Record side effects and idempotency decisions outside the model loop.

When a tool mutates product state, make the operation idempotent before adding provider retries or fallback models. A retry should not create duplicate refunds, tickets, messages, or database writes.

## Provider And Capability Limits

Provider models differ. Test streaming, tools, structured output, multimodal content, and rate limits per configured model id. A model that works for simple text may still fail once a workflow adds tool schemas or document content.

Provider failures should be classified before retrying. Retry bounded transient failures such as timeouts or rate limits. Do not retry invalid requests, schema mismatches, permission failures, or tool side effects unless your application can prove the operation is safe.

## Retry Policy

Retries belong outside the prompt. A runner or job worker should decide whether an error is retryable, how many attempts are allowed, and whether the workflow has already performed a side effect.

For read-only completions, bounded retries are usually safe. For tool-calling agents, retries require more care. A failed final model call may happen after a tool already changed product state. Use idempotency records around side-effect tools before retrying the full run.

## Runner Error Mapping

Keep error mapping centralized:

```ts
try {
  return await runSupportTurn(input);
} catch (error) {
  return mapSupportError(error);
}
```

The mapper should return product responses, not raw provider or stack-trace details. Observers, event stores, and logs should keep the diagnostic detail needed for debugging.

For streaming routes, decide what happens after partial output has already reached the client. Some products should emit a final error event. Others should stop the stream and record the failure in traces. Make that policy explicit before launch.
