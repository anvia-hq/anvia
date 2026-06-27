---
title: Dynamic Tool Catalogs
description: A pattern for selecting relevant tools from a larger permissioned catalog.
section: examples
sidebar:
  group: Tool Patterns
  order: 2
---

Dynamic tool catalogs keep large tool sets out of every model request. The application embeds tool definitions, filters the catalog by tenant or role, and lets Anvia select the most relevant tools for the current prompt. Catalog selection narrows exposure; it does not replace tool-level authorization.

## Scenario

An internal support agent has 80 admin tools. A refund question should expose refund and order tools, not deployment, billing-plan, or workspace-admin tools. High-risk tools still enforce approval and permissions if selected.

## Flow

| Step | Owner |
| --- | --- |
| create request-scoped tools | app |
| embed tool definitions | Anvia `createToolIndex(...)` |
| filter by tenant/role | app policy expressed as vector metadata |
| select relevant tools per prompt | Anvia `.dynamicTools(...)` |
| authorize execution | each tool/service |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { createToolIndex } from "@anvia/core/tool";
import { vectorFilter } from "@anvia/core/vector-store";

export async function createSupportAdminAgent(scope: SupportAdminScope) {
  const tools = [
    ...createOrderTools(scope),
    ...createRefundTools(scope),
    ...createTicketTools(scope),
    ...createAccountTools(scope),
  ];

  const toolIndex = await createToolIndex(scope.embeddingModel, tools, {
    metadata: (tool) => ({
      tenantId: scope.operator.tenantId,
      role: scope.operator.role,
      risk: tool.name.includes("refund") ? "high" : "normal",
    }),
    content: (_tool, definition) => [
      definition.name,
      definition.description,
      JSON.stringify(definition.parameters),
    ],
  });

  const allowedToolFilter = vectorFilter.and(
    vectorFilter.eq("tenantId", scope.operator.tenantId),
    vectorFilter.eq("role", scope.operator.role),
  );

  return new AgentBuilder("support-admin", scope.model)
    .instructions(`
Use the smallest relevant tool set for each request.
If no selected tool can safely perform the action, explain what is missing.
Do not assume a tool is authorized just because it was selected.
    `)
    .dynamicTools(toolIndex, {
      topK: 6,
      threshold: 0.68,
      filter: allowedToolFilter,
    })
    .defaultMaxTurns(4)
    .build();
}
```

High-risk tools still guard themselves:

```ts
const requestRefund = createRefundTool({
  user: scope.operator,
  services: scope.services,
  auditLog: scope.auditLog,
  idempotencyKey: scope.idempotencyKey,
  requiredPermission: "orders:refund",
});
```

## Production Checks

| Check | Why |
| --- | --- |
| tool descriptions are specific | improves tool retrieval quality |
| metadata includes tenant and role | prevents irrelevant tools from being selected |
| high-risk tools keep approvals | selection is not authorization |
| selected tools are logged | makes unexpected tool exposure debuggable |
| catalog is rebuilt when tools change | keeps embeddings aligned with definitions |

## Failure Modes

- Search threshold is so low that unrelated tools are exposed.
- Tool descriptions are vague, so retrieval picks the wrong capability.
- Dangerous tools rely only on catalog filtering.
- The catalog is global when tools should be tenant- or role-specific.
- Tool index creation happens in the hot path for every prompt.

## Next Patterns

- [Permissioned Tools](/docs/examples/permissioned-tools)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Testing Harness](/docs/examples/testing-harness)
