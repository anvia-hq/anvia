---
title: Example Anatomy
description: The format for examples that show complete Anvia build patterns without becoming long tutorials.
section: examples
sidebar:
  group: Start Here
  order: 2
---

An example should show enough of the application flow to make Anvia's role clear. It should not stop at a single isolated method call, and it should not become a full app tutorial.

## Required Shape

| Part | What it should show |
| --- | --- |
| Build goal | The product or workflow someone is trying to ship. |
| Flow | The steps from request or source data to the final product result. |
| Anvia surface | The agents, tools, models, embeddings, vector stores, extractors, pipelines, observers, or adapters involved. |
| Application boundary | The code your app owns: auth, services, storage, permissions, queues, jobs, and audit. |
| Minimal TypeScript | One compact vertical slice that connects the important pieces. |
| Swap points | Which provider, vector store, model, or transport can change without rewriting the flow. |
| Production checks | The failure modes that matter before real users or real data. |

## Good Scope

For a RAG example, a single `embedTexts(...)` call is too small. The useful scope is source loading, OCR or text extraction, chunking, embedding, vector storage, retrieval, and grounded answer behavior.

For a tool example, a `createTool(...)` call with a schema is too small. The useful scope is request-scoped user and tenant data, service-level authorization, output narrowing, audit, and denied paths.

For an agent example, `new AgentBuilder(...).build()` is too small. The useful scope is the route or job boundary, runner, scoped tools, context, model call, trace metadata, persistence, and response shape.

## Compact Vertical Slice

The code can still be short:

```ts
export async function runWorkflow(input: WorkflowInput) {
  const user = await input.auth.requireUser();
  const agent = createWorkflowAgent({
    model: input.model,
    user,
    services: input.services,
    knowledge: input.knowledge,
  });

  const response = await agent
    .prompt(input.message)
    .withTrace({
      name: "workflow",
      userId: user.id,
      metadata: { tenantId: user.tenantId },
    })
    .send();

  await input.events.record({
    userId: user.id,
    output: response.output,
    traceId: response.trace?.traceId,
  });

  return { output: response.output };
}
```

The names can be product-specific. The pattern should stay visible: resolve app state, compose Anvia runtime, run the workflow, persist what matters, and return a product result.

## What To Avoid

- examples that only call one API and never show where it belongs
- examples that hide auth, permissions, or persistence in comments
- examples that put user or tenant ids in model-controlled arguments
- examples that show RAG without ingestion or retrieval boundaries
- examples that show side effects without idempotency, approval, or audit
- examples that copy package reference docs instead of connecting features into a build pattern
