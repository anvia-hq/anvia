---
title: Examples
description: A compact pattern library for building Anvia applications.
section: examples
sidebar:
  group: Start Here
  order: 0
---

Examples teach reusable application shapes. They are not a catalog of tiny scripts. Each page starts from a product scenario, shows a TypeScript shape, and calls out which boundary your application owns.

## Example Anatomy

Most pages follow this shape:

```ts
// Route, worker, or UI action
const result = await runSupportTurn({
  conversationId: body.conversationId,
  message: body.message,
  auth,
  conversations,
  services: { orders, tickets },
});

// Runner
export async function runSupportTurn(input: SupportTurnInput) {
  const user = await input.auth.requireUser();
  const history = await input.conversations.loadMessages(input.conversationId);
  const agent = createSupportAgent({ user, services: input.services });

  const response = await agent
    .prompt([...history, Message.user(input.message)])
    .withTrace({ name: "support-chat", userId: user.id })
    .send();

  await input.conversations.append(input.conversationId, response.messages);
  return { output: response.output };
}
```

The exact framework can change. The pattern is the point: a thin transport calls a runner, the runner resolves product state, Anvia runs the model/tool loop, and the application persists the result.

## Reading Order

| Stage | Start with | Why |
| --- | --- | --- |
| Foundation | [Agent Harness](/docs/examples/agent-harness) | Establish the application-owned boundary around one model run. |
| Request flow | [Request Runner](/docs/examples/request-runner) | Keep routes, jobs, and tests calling one explicit workflow function. |
| Runtime shape | [Agent Structure](/docs/examples/agent-structure) | Separate stable agent configuration from request-local state. |
| Context | [Context and Memory](/docs/examples/context-and-memory) | Decide which facts belong in instructions, messages, memory, or retrieval. |
| Tooling | [Tool Boundaries](/docs/examples/tool-boundaries) | Wrap product behavior as narrow, permission-aware capabilities. |
| Production | [Guarded Side Effects](/docs/examples/guarded-side-effects) | Add approvals, idempotency, audit, and retry safety before launch. |

## Pattern Map

| Need | Pattern |
| --- | --- |
| Understand how this section is meant to be read | [How to Use Examples](/docs/examples/how-to-use-examples) |
| Wrap one product request in an agent runtime boundary | [Agent Harness](/docs/examples/agent-harness) |
| Wrap one route, job, action, or queue request | [Request Runner](/docs/examples/request-runner) |
| Keep stable agent setup separate from request state | [Agent Structure](/docs/examples/agent-structure) |
| Decide what enters the prompt, history, and memory | [Context and Memory](/docs/examples/context-and-memory) |
| Expose product behavior through narrow tools | [Tool Boundaries](/docs/examples/tool-boundaries) |
| Select relevant tools from a large catalog | [Dynamic Tool Catalogs](/docs/examples/dynamic-tool-catalogs) |
| Validate tool inputs, outputs, and product states | [Tool Validation](/docs/examples/tool-validation) |
| Ask a person before the workflow continues | [Human Input](/docs/examples/human-input) |
| Build or refresh retrieval data | [RAG Ingestion](/docs/examples/rag-ingestion) |
| Combine retrieval with an account-aware agent | [Retrieval Agent](/docs/examples/retrieval-agent) |
| Ground model responses in selected documents | [Document Grounding](/docs/examples/document-grounding) |
| Consume text, tool, and final stream events | [Streaming Events](/docs/examples/streaming-events) |
| Run structured work outside the request path | [Pipeline Worker](/docs/examples/pipeline-worker) |
| Track status, retries, and results for background work | [Long-running Jobs](/docs/examples/long-running-jobs) |
| Coordinate specialist agents without losing the parent workflow | [Multi-agent Coordination](/docs/examples/multi-agent-coordination) |
| Protect writes, approvals, and irreversible actions | [Guarded Side Effects](/docs/examples/guarded-side-effects) |
| Combine app tools with MCP server tools | [MCP Agent](/docs/examples/mcp-agent) |
| Run file and command work in an isolated workspace | [Sandbox Execution](/docs/examples/sandbox-execution) |
| Swap providers without rewriting product code | [Provider Switching](/docs/examples/provider-switching) |
| Test deterministic boundaries around model behavior | [Testing Harness](/docs/examples/testing-harness) |
| Connect logs, traces, events, and evals into one feedback loop | [Observability Loop](/docs/examples/observability-loop) |
| Build repeatable regression checks | [Eval Loop](/docs/examples/eval-loop) |
| Review an agent workflow before launch | [Production Readiness](/docs/examples/production-readiness) |
| Model common customer-support flows | [Support Agent](/docs/examples/support-agent) |
| Model research and synthesis flows | [Research Agent](/docs/examples/research-agent) |
| Model internal operations and admin flows | [Backoffice Agent](/docs/examples/backoffice-agent) |
| Model codebase workflows with file and command boundaries | [Coding Agent](/docs/examples/coding-agent) |
