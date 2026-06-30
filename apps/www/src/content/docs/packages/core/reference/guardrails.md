---
title: "Guardrails"
description: "Experimental policy APIs for input, tool, tool-result, and output guardrails."
section: packages
sidebar:
  group: "Reference"
  order: 8
  label: "Guardrails"
---
Import from `@anvia/core` or `@anvia/core/guardrails`.

Guardrails are an experimental policy layer for enforcing application boundaries around an agent run. They are not prompt instructions. They run in product code and can allow, block, rewrite, or request tool approval.

## defineGuardrailPolicy

```ts
type GuardrailMode = "enforce" | "observe";

type GuardrailPolicyOptions = {
  id: string;
  mode?: GuardrailMode;
  input?: InputGuardrail[];
  tools?: ToolGuardrail[];
  toolResults?: ToolResultGuardrail[];
  output?: OutputGuardrail[];
};

function defineGuardrailPolicy(options: GuardrailPolicyOptions): GuardrailPolicy;
```

Purpose: group guardrails into a policy that can be attached to an agent or prompt request.

Return behavior: missing `mode` defaults to `"enforce"`. Agent-level policies run before request-level policies. In `"observe"` mode, decisions are recorded but do not block, rewrite, or request approval.

## Guardrail Factories

```ts
function defineInputGuardrail(options: {
  id: string;
  check(ctx: InputGuardrailContext, actions: InputGuardrailActions): InputGuardrailResult | Promise<InputGuardrailResult>;
}): InputGuardrail;

function defineToolGuardrail<Args = unknown>(options: {
  id: string;
  tool?: string | string[];
  check(ctx: ToolGuardrailContext<Args>, actions: ToolGuardrailActions): ToolGuardrailResult | Promise<ToolGuardrailResult>;
}): ToolGuardrail<Args>;

function defineToolResultGuardrail<Args = unknown>(options: {
  id: string;
  tool?: string | string[];
  check(ctx: ToolResultGuardrailContext<Args>, actions: ToolResultGuardrailActions): ToolResultGuardrailResult | Promise<ToolResultGuardrailResult>;
}): ToolResultGuardrail<Args>;

function defineOutputGuardrail(options: {
  id: string;
  check(ctx: OutputGuardrailContext, actions: OutputGuardrailActions): OutputGuardrailResult | Promise<OutputGuardrailResult>;
}): OutputGuardrail;
```

Purpose: create typed checks for each runtime boundary.

Return behavior: `check(ctx, actions)` receives pure context data plus injected actions such as `allow()`, `block(...)`, `rewrite(...)`, and, for tool guardrails, `requestApproval(...)`.

## Boundary Order

```txt
input -> model request -> tool -> tool result -> model continuation -> output
```

- input guardrails run before memory and model work
- tool guardrails run after tool-call hooks and tool input middleware, then before approvals and execution
- tool-result guardrails run after tool output middleware and before the result returns to the model
- output guardrails run before final response return, final stream event, and final assistant memory commit

When enforced output guardrails are active during streaming, text and reasoning deltas are buffered so unsafe raw output is not emitted before the final output is checked.

## Example

```ts
import {
  AgentBuilder,
  defineGuardrailPolicy,
  defineOutputGuardrail,
  defineToolGuardrail,
} from "@anvia/core";

const largeRefundApproval = defineToolGuardrail<{ amountCents: number }>({
  id: "large-refund-approval",
  tool: "issue_refund",
  check(ctx, { allow, requestApproval }) {
    return ctx.args.amountCents > 10_000
      ? requestApproval({ reason: "Large refund requires review." })
      : allow();
  },
});

const redactOutput = defineOutputGuardrail({
  id: "redact-output-secrets",
  check(ctx, { allow, rewrite }) {
    const outputText = ctx.outputText.replace(/sk-[a-z0-9]+/gi, "[redacted]");
    return outputText === ctx.outputText
      ? allow()
      : rewrite({ outputText, reason: "secret_redacted" });
  },
});

const policy = defineGuardrailPolicy({
  id: "support-production",
  tools: [largeRefundApproval],
  output: [redactOutput],
});

const agent = new AgentBuilder("support", model)
  .tools(supportTools)
  .guardrails(policy)
  .approvals({ handler: approvalRuntime.decide })
  .build();
```

## Built-In Text Helpers

```ts
guardrails.blockText({
  id: "block-internal-ids",
  boundary: "input",
  patterns: [/internal_[a-z0-9]+/i],
  reason: "internal_id_detected",
  message: "Remove internal identifiers before sending.",
});

guardrails.redactText({
  id: "redact-tool-secret",
  boundary: "tool_result",
  patterns: [/token=[^\s]+/gi],
  replacement: "token=[redacted]",
  reason: "secret_redacted",
});
```

Purpose: deterministic pattern-based blocking and redaction for input, tool-result, and output boundaries.

## Decisions

```ts
type GuardrailDecisionRecord = {
  policyId: string;
  guardrailId: string;
  boundary: "input" | "tool" | "tool_result" | "output";
  mode: "enforce" | "observe";
  action: "allow" | "block" | "rewrite" | "request_approval" | "error";
  applied: boolean;
  reason?: string;
  message?: string;
  metadata?: JsonObject;
  latencyMs: number;
};
```

Return behavior: prompt responses and final stream events include `guardrails?: GuardrailDecisionRecord[]`. Streams also emit `guardrail_decision` events. Observers receive `guardrail.decision` events.

## Advanced Exported Types

These symbols are exported for integration packages, tests, and advanced composition. App code should usually use `defineGuardrailPolicy(...)`, the boundary factories, and injected `actions`.

```ts
type GuardrailBoundary = "input" | "tool" | "tool_result" | "output";
type GuardrailRunContext = { agentId: string; runId: string; sessionId?: string; metadata?: JsonObject };
type GuardrailPolicyInput = GuardrailPolicy | GuardrailPolicy[];

type GuardrailActionName = "allow" | "block" | "rewrite" | "request_approval" | "error";
type GuardrailActionBase = { reason?: string; metadata?: JsonObject };
type GuardrailAllow = GuardrailActionBase & { action: "allow" };
type GuardrailBlock = GuardrailActionBase & { action: "block"; reason: string; message?: string };
type GuardrailCommonActions = { allow(...): GuardrailAllow; block(...): GuardrailBlock };

type InputGuardrailRewrite = GuardrailActionBase & { action: "rewrite"; prompt?: Message; inputText?: string };
type ToolGuardrailRewrite = GuardrailActionBase & { action: "rewrite"; args: JsonValue | string };
type ToolGuardrailApprovalRequest = GuardrailActionBase & { action: "request_approval"; rejectMessage?: string };
type ToolResultGuardrailRewrite = GuardrailActionBase & { action: "rewrite"; result?: string; structuredResult?: ToolResultContent[] };
type OutputGuardrailRewrite = GuardrailActionBase & { action: "rewrite"; outputText: string };

type InputGuardrailRunResult = unknown;
type ToolGuardrailRunResult = unknown;
type ToolResultGuardrailRunResult = unknown;
type OutputGuardrailRunResult = unknown;
```

```ts
function normalizeGuardrailPolicies(...): GuardrailPolicy[];
function appendGuardrailPolicies(...): GuardrailPolicy[];
function hasEnforcedOutputGuardrails(...): boolean;
function runInputGuardrails(...): Promise<InputGuardrailRunResult>;
function runToolGuardrails(...): Promise<ToolGuardrailRunResult>;
function runToolResultGuardrails(...): Promise<ToolResultGuardrailRunResult>;
function runOutputGuardrails(...): Promise<OutputGuardrailRunResult>;
```
