---
title: Hooks and run control
description: Observe, alter, cancel, and gate agent runs with hooks.
section: advanced
sidebar:
  group: Agent runtime
  order: 17
  label: Hooks
---

Hooks let application code observe and control a run while it is executing. Use them for policy checks, run cancellation, tool gating, audit annotations, and request-local behavior that belongs near the runtime.

Hooks are not a replacement for tool authorization. Tools must still enforce product permissions before performing side effects.

## Create A Hook

```ts
import { PromptCancelledError, createHook } from "@anvia/core";

const hook = createHook({
  onRunStart({ maxTurns, run }) {
    if (maxTurns > 8) {
      return run.cancel("This workflow allows at most 8 turns.");
    }
  },
  onToolCall({ toolName, tool }) {
    if (toolName === "delete_account") {
      return tool.requestApproval({
        reason: "Deleting an account requires reviewer approval.",
      });
    }
  },
  onToolResult({ result, run }) {
    if (result.includes("POLICY_BLOCKED")) {
      return run.cancel("A downstream policy blocked the request.");
    }
  },
});
```

Attach default hooks on the builder:

```ts
const agent = new AgentBuilder("support", model).hook(hook).build();
```

Or override them for one run:

```ts
await agent.prompt(input).withHook(hook).send();
```

## Hook Points

Run hooks:

- `onRunStart`
- `onRunEnd`
- `onRunError`

Turn and completion hooks:

- `onTurnStart`
- `onTurnEnd`
- `onCompletionCall`
- `onCompletionResponse`
- `onCompletionError`

Tool hooks:

- `onToolCall`
- `onToolResult`
- `onToolError`

Run hooks can continue or cancel. Tool call hooks can continue, skip, cancel, or request approval.

## Cancellation

Returning `run.cancel(reason)` stops the prompt and raises `PromptCancelledError`. Map that error at the runner boundary:

```ts
try {
  const session = agent.session(threadId);
  const request = session.prompt(message);

  return await request.send();
} catch (error) {
  if (error instanceof PromptCancelledError) {
    return { output: "The request was stopped by policy." };
  }
  throw error;
}
```

Use cancellation for policy failures, safety limits, and explicit user stops. Do not use cancellation to hide normal provider errors; map provider failures separately.

## Tool Control

Tool hooks are useful when the model selected a tool but application policy needs a final say:

```ts
const hook = createHook({
  onToolCall({ toolName, args, tool }) {
    if (toolName === "send_refund" && !canRequestRefund(args)) {
      return tool.skip("Refund is not allowed for this order.");
    }
    return tool.run();
  },
});
```

`tool.skip(...)` returns the skip reason as the tool result, so the model can continue the conversation. `tool.cancel(...)` stops the whole run.

## Hooks And Middleware

Use hooks for decisions about the run: continue, cancel, skip a tool, or request approval.

Use middleware to transform completion requests, completion responses, tool inputs, and tool outputs. Middleware is better for redaction, metadata injection, normalization, and instrumentation that should not decide whether the run continues.

## Production Guidance

Keep hooks deterministic and fast. If a hook needs database state, load it in the runner and close over a small policy object. Long network calls inside hooks make runtime behavior harder to test and harder to explain.

Prefer explicit reasons for cancellation and skipped tools. Those reasons are useful for audit records, tests, and internal debugging, even when the user-facing message is more generic.
