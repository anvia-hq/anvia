---
title: Dynamic context
description: Inject request-time facts, retrieval results, and runtime state.
section: advanced
sidebar:
  group: Agent runtime
  order: 14
---

Dynamic context lets an agent retrieve relevant documents for each turn without manually building prompt text. Configure one or more vector indexes on the agent, and core will search them during the run.

Use dynamic context when the model needs a small set of relevant facts from a larger or changing corpus: docs pages, support articles, product policies, tenant-specific knowledge, or internal records that have already been permission-filtered.

## Add Dynamic Context

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

const agent = new AgentBuilder("docs-support", model)
  .instructions("Answer with the retrieved documentation when it is relevant.")
  .dynamicContext(docsIndex, {
    topK: 5,
    threshold: 0.72,
    filter: vectorFilter.eq("product", "platform"),
  })
  .build();
```

`docsIndex` must implement `VectorSearchIndex`. It can be an in-memory index from core or an adapter around your production vector database.

## What Happens During A Turn

For every turn, core:

1. Extracts retrieval text from the current prompt.
2. Searches each registered dynamic context index.
3. Applies `topK`, `threshold`, and `filter`.
4. Converts matching results into `Document` objects.
5. Sends those documents with the model request for that turn.

Dynamic context is selected per turn. If the model calls a tool and the run continues, the next turn can retrieve different context based on the latest runtime prompt.

## Default Formatting

By default, core maps a vector result into a document like this:

- `id` comes from the vector result id
- `text` is the string document, or JSON for non-string documents
- metadata is converted into string document properties

This default works for simple text records. Use `format` when the stored document needs a clearer shape:

```ts
type DynamicContextOptions = Parameters<AgentBuilder["dynamicContext"]>[1];

const policyContext = {
  topK: 4,
  threshold: 0.75,
  format(result) {
    return {
      id: `policy:${result.id}`,
      text: [
        `Title: ${result.metadata?.title ?? "Untitled"}`,
        `Updated: ${result.metadata?.updatedAt ?? "unknown"}`,
        "",
        String(result.document),
      ].join("\n"),
    };
  },
} satisfies DynamicContextOptions;

const agent = new AgentBuilder("policy", model)
  .dynamicContext(policyIndex, policyContext)
  .build();
```

Keep formatted context concise. Dynamic context should give the model relevant facts, not an unbounded dump of the corpus.

## Filters And Permissions

Filters narrow the search before results reach the model:

```ts
const filter = vectorFilter.and(
  vectorFilter.eq("tenantId", tenant.id),
  vectorFilter.eq("visibility", "support"),
);

const agent = new AgentBuilder("tenant-support", model)
  .dynamicContext(tenantDocsIndex, {
    topK: 6,
    threshold: 0.7,
    filter,
  })
  .build();
```

Treat filters as part of your data-access layer. Prompt instructions can say what the model should do with retrieved context, but they must not be the only thing preventing unauthorized documents from being retrieved.

## Dynamic Context Versus Static Context

Use static `.context(...)` for small documents that are safe for every run of the agent. Use `.dynamicContext(...)` when the right documents depend on the prompt, tenant, product area, access tier, or current workflow.

Static context is always included. Dynamic context is searched at runtime and only matching results are included.

## Dynamic Context Versus Tools

Use dynamic context when the model only needs read-only facts to answer. Use a tool when the model needs to query live systems, enforce permissions, perform actions, or return structured operational data.

For example, product documentation is usually dynamic context. Looking up a user's latest invoice should usually be a tool because it depends on live account permissions and may expose sensitive data.

## Multiple Indexes

An agent can register multiple dynamic context indexes:

```ts
const agent = new AgentBuilder("support", model)
  .dynamicContext(publicDocsIndex, {
    topK: 4,
    threshold: 0.72,
  })
  .dynamicContext(policyIndex, {
    topK: 2,
    threshold: 0.78,
    filter: vectorFilter.eq("audience", "support"),
  })
  .build();
```

Core searches each registered index and appends all formatted documents to the model request. Keep the total result count small enough that the model can still focus on the user's request.

## Production Guidance

Evaluate retrieval quality before shipping. Test common prompts, missing-context prompts, ambiguous prompts, and permission-sensitive prompts. Tune `topK`, `threshold`, metadata filters, chunk size, and formatting together.

If the model often ignores retrieved context, improve the instruction and formatting. If the model receives irrelevant context, tighten filtering or raise the threshold. If the context may contain secrets, redact before indexing or before formatting the result.
