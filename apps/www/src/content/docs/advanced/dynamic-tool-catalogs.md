---
title: Tool sets and dynamic tools
description: Group, search, select, and expose tools dynamically at runtime.
section: advanced
sidebar:
  group: Tools and action safety
  order: 24
  label: Tool sets
---

Tool sets collect static tools. Dynamic tools let the runtime select relevant tool definitions from an index for each turn.

Use static tools when the agent has a small, stable action surface. Use dynamic tools when the available catalog is large enough that sending every tool definition to the model would be noisy or expensive.

## ToolSet

`ToolSet` groups tools and can be shared across builders:

```ts
import { AgentBuilder } from "@anvia/core";
import { ToolSet } from "@anvia/core/tool";

const supportToolSet = ToolSet.fromTools([
  createSearchOrdersTool(scope),
  createGetInvoiceTool(scope),
  createEscalationTool(scope),
]);

const agent = new AgentBuilder("support", model)
  .useToolSet(supportToolSet)
  .build();
```

`ToolSet` can add, delete, inspect, and call tools. In application code, prefer constructing it from known tools instead of mutating a shared global set at request time.

At the lower level, `ToolSet` exposes `contains(...)`, `get(...)`, `values(...)`, `getToolDefinitions(...)`, and `call(...)`. `call(...)` accepts the tool name, raw JSON argument string, and optional `ToolCallContext`; it can throw `ToolNotFoundError`, `ToolJsonError`, or `ToolCallError`. Use those errors at runner boundaries when you need precise logging or product-safe error mapping.

## Static Tools

For most agents, static tools are enough:

```ts
const agent = new AgentBuilder("billing", model)
  .tools([
    createGetInvoiceTool(scope),
    createSearchPaymentsTool(scope),
  ])
  .build();
```

Static tool definitions are included in every model turn. Keep the static set small, relevant, and safe for the agent role.

## Dynamic Tool Index

Build a dynamic index from a larger catalog:

```ts
import { AgentBuilder } from "@anvia/core";
import { createToolIndex } from "@anvia/core/tool";
import { vectorFilter } from "@anvia/core/vector-store";

const toolIndex = await createToolIndex(embeddingModel, allSupportTools, {
  metadata(tool) {
    return {
      productArea: tool.name.startsWith("billing_") ? "billing" : "support",
    };
  },
});

const supportToolSearch = {
  topK: 6,
  threshold: 0.72,
  filter: vectorFilter.eq("productArea", "billing"),
};

const agent = new AgentBuilder("billing-support", model)
  .dynamicTools(toolIndex, supportToolSearch)
  .build();
```

During each turn, core searches the dynamic tool index using the current prompt text. Matching tool definitions are added to the completion request. If a dynamic tool is selected by the model, core calls it from the indexed `ToolSet`.

`createToolIndex(...)` returns a `DynamicToolIndex`, which is a `VectorSearchIndex` plus the backing `toolSet`. For custom indexes, implement the same shape and use `isDynamicToolIndex(...)` to guard unknown values. `embedTools(...)` is available when you need embedded tool documents but want to store them in your own vector database instead of the in-memory index.

## Embedding Text

By default, tools are embedded from name, description, and JSON parameters. Customize the embedding text when tool selection needs more search terms:

```ts
const toolIndex = await createToolIndex(embeddingModel, tools, {
  content(tool, definition) {
    return [
      definition.name,
      definition.description,
      "Use for refunds, credits, invoice adjustments, and payment disputes.",
    ];
  },
});
```

Keep embedding text descriptive but honest. Do not add unrelated keywords just to force a tool to appear.

## Static And Dynamic Together

An agent can use both:

```ts
const agent = new AgentBuilder("support", model)
  .tool(createEscalationTool(scope))
  .dynamicTools(toolIndex, {
    topK: 5,
    threshold: 0.7,
  })
  .build();
```

Static tools are always present. Dynamic tools are retrieved per turn. If a dynamic tool has the same name as a static tool, core keeps the static definition and skips the duplicate dynamic definition.

## Safety Boundaries

Dynamic selection controls which definitions the model sees. It does not authorize tool execution. Each tool handler must still enforce user, tenant, and product permissions.

Use metadata filters to keep unavailable tools out of retrieval results:

```ts
const filter = vectorFilter.and(
  vectorFilter.eq("tenantId", tenant.id),
  vectorFilter.eq("plan", tenant.plan),
);
```

Filters should match your product access model. Prompt instructions are not enough.

## Dynamic Tool Checklist

Before shipping dynamic tools, check:

- top results are relevant for common prompts
- sensitive tools require approvals or are filtered out
- every dynamic tool handler enforces permissions
- duplicate names are intentional
- selection behavior is covered by tests or evals
