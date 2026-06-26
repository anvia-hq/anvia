---
title: Metadata filters
description: Filter retrieval by structured metadata and user context.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 33
---

Metadata filters constrain vector search before documents reach the model. Use them for tenant boundaries, product scopes, visibility rules, freshness, status, and other retrieval-time constraints.

Filters are not prompt instructions. They are application data-access rules attached to the search request.

## Store Filterable Metadata

Add metadata when embedding documents:

```ts
import { embedDocuments } from "@anvia/core/embeddings";

const embedded = await embedDocuments(embeddingModel, documents, {
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    tenantId: document.tenantId,
    product: document.product,
    visibility: document.visibility,
    priority: document.priority,
    published: document.status === "published",
  }),
});
```

Metadata values can be strings, numbers, booleans, or `null`. Keep metadata flat. Store ids and flags, not large nested records.

## Filter A Search

```ts
import { vectorFilter } from "@anvia/core/vector-store";

const filter = vectorFilter.eq("tenantId", tenant.id);

const results = await index.search({
  query: "billing limits",
  topK: 5,
  filter,
});
```

The filter runs before results are returned. Documents without matching metadata are excluded.

## Combine Conditions

```ts
const tenantBillingFilter = vectorFilter.and(
  vectorFilter.eq("tenantId", tenant.id),
  vectorFilter.eq("product", "billing"),
);

const results = await index.search({
  query: "invoice settings",
  topK: 5,
  threshold: 0.72,
  filter: tenantBillingFilter,
});
```

Use `and(...)` for required constraints and `or(...)` for allowed alternatives:

```ts
const publicOrTenantFilter = vectorFilter.or(
  vectorFilter.eq("visibility", "public"),
  vectorFilter.eq("tenantId", tenant.id),
);
```

## Range Filters

Use `gt(...)` and `lt(...)` for values with meaningful ordering:

```ts
const filter = vectorFilter.and(
  vectorFilter.eq("product", "support"),
  vectorFilter.gt("priority", 2),
);
```

Number comparisons are the common case. String and boolean comparisons are also supported, but use them deliberately so ordering is obvious to the next maintainer.

## Dynamic Context Filters

Attach filters to dynamic context:

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

const supportContextFilter = vectorFilter.and(
  vectorFilter.eq("tenantId", tenant.id),
  vectorFilter.eq("visibility", "support"),
);

const agent = new AgentBuilder("tenant-support", model)
  .dynamicContext(tenantDocsIndex, {
    topK: 6,
    threshold: 0.72,
    filter: supportContextFilter,
  })
  .build();
```

Build the filter from authenticated product state, not from model output. The model can decide how to use retrieved facts, but it should not decide which tenant's facts are eligible.

## Search Tool Filters

Filters also apply to vector search tools:

```ts
const searchDocs = docsIndex.asTool({
  name: "search_docs",
  description: "Search documentation available to the current tenant.",
  topK: 4,
  filter: supportContextFilter,
});
```

If a tool is exposed to the model, apply the same permission filter you would apply to automatic context. Tool descriptions can explain scope, but they should not be the enforcement mechanism.

## Production Guidance

Prefer explicit metadata over parsing ids or source paths at query time. For example, store `tenantId`, `product`, and `visibility` as metadata fields even if those values also appear in the document id.

Test filters with permission-sensitive prompts:

- a tenant asking about its own private document
- a tenant asking about another tenant's private document
- a public document that should be visible to all tenants
- archived or draft material that should not be retrieved

If a document should never be visible to a model, do not index it into a shared corpus without a reliable filter path.
