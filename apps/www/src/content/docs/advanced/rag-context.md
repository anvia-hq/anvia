---
title: RAG context
description: Feed retrieved knowledge into agent prompts safely.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 34
---

RAG context is the runtime side of retrieval. Ingestion prepares the index. The agent run decides how retrieved knowledge enters the model request.

Core gives you three practical attachment points:

- `.dynamicContext(...)` for automatic document context
- `index.asTool(...)` for model-directed search
- `.dynamicTools(...)` for large tool catalogs

Pick the attachment based on who should decide retrieval: your application, the agent runtime, or the model.

## Prepare The Index First

Do ingestion before the prompt runs:

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";

const embedded = await embedDocuments(embeddingModel, articles, {
  id: (article) => article.slug,
  content: (article) => `${article.title}\n${article.body}`,
  metadata: (article) => ({
    product: article.product,
    published: article.published,
  }),
});

const docsIndex = InMemoryVectorStore.fromDocuments(embedded).index(embeddingModel);
```

In production, this usually lives in a worker, startup task, admin import, or vector database sync job. Do not rebuild the full index for every user message.

## Automatic Retrieval

Use `.dynamicContext(...)` when every request should receive relevant knowledge:

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

const publicDocsContext = {
  topK: 4,
  threshold: 0.74,
  filter: vectorFilter.eq("published", true),
} satisfies Parameters<AgentBuilder["dynamicContext"]>[1];

const agent = new AgentBuilder("docs-support", model)
  .instructions("Use retrieved documentation when it is relevant.")
  .dynamicContext(docsIndex, publicDocsContext)
  .build();
```

During the run, core searches the registered index with the current prompt text and sends matching documents with the completion request.

This is a good default for documentation assistants, policy assistants, and workflows where knowledge is almost always needed.

## Format Retrieved Documents

Use `format(...)` when the stored document is an object or the model needs a source-aware shape:

```ts
type PolicyDocument = {
  title: string;
  body: string;
};

const policyContext = {
  topK: 3,
  threshold: 0.76,
  format(result) {
    const policy = result.document as PolicyDocument;

    return {
      id: `policy:${result.id}`,
      text: [
        `Title: ${policy.title}`,
        `Source: ${result.metadata?.source ?? "unknown"}`,
        "",
        policy.body,
      ].join("\n"),
    };
  },
} satisfies Parameters<AgentBuilder["dynamicContext"]>[1];

const policyAgent = new AgentBuilder("policy-support", model)
  .dynamicContext(policyIndex, policyContext)
  .build();
```

Keep formatted context concise. Retrieval should give the model the facts it needs, not an unbounded dump of the corpus.

## Model-Directed Search

Use `index.asTool(...)` when the model should decide whether and when to search:

```ts
const searchRunbooks = runbookIndex.asTool({
  name: "search_runbooks",
  description: "Search incident runbooks for operational guidance.",
  topK: 3,
  threshold: 0.72,
});

const agent = new AgentBuilder("incident-assistant", model)
  .instructions("Search runbooks before answering incident response questions.")
  .tool(searchRunbooks)
  .defaultMaxTurns(3)
  .build();
```

This works well when retrieval is occasionally useful, when the model may need to refine its query, or when search results should appear as tool results in the run.

## Dynamic Tools Are Different

Dynamic context retrieves knowledge. Dynamic tools retrieve tool definitions.

```ts
const agent = new AgentBuilder("support", model)
  .dynamicContext(policyIndex, {
    topK: 3,
    threshold: 0.74,
  })
  .dynamicTools(toolIndex, {
    topK: 5,
    threshold: 0.7,
  })
  .build();
```

Use both when an agent has a large knowledge base and a large tool catalog. The first narrows documents. The second narrows capabilities.

## Runtime Ownership

A production request should pass prepared indexes into an agent factory or runner:

```ts
import { AgentBuilder } from "@anvia/core";
import type { CompletionModel } from "@anvia/core/completion";
import { type VectorSearchIndex, vectorFilter } from "@anvia/core/vector-store";

type SupportArticle = {
  id: string;
  title: string;
  body: string;
};

export function createSupportAgent(input: {
  model: CompletionModel;
  docsIndex: VectorSearchIndex<SupportArticle>;
  tenantId: string;
}) {
  const tenantFilter = vectorFilter.eq("tenantId", input.tenantId);

  return new AgentBuilder("support", input.model)
    .instructions("Answer from retrieved support documentation when possible.")
    .dynamicContext(input.docsIndex, {
      topK: 5,
      threshold: 0.72,
      filter: tenantFilter,
    })
    .build();
}
```

The runner owns auth, tenant resolution, and which index or filter is allowed. The prompt should contain the user's request, not hidden retrieval policy.

## Tuning

Tune retrieval with real prompts:

- lower `topK` when context distracts the model
- raise `threshold` when weak matches pollute answers
- improve chunking when answers need several unrelated passages
- improve formatting when the model ignores source titles or dates
- improve metadata filters when unauthorized or stale documents appear

If a prompt can be answered without retrieval and the model keeps searching anyway, use automatic dynamic context instead of a search tool. If every answer gets irrelevant context, tighten filters, chunking, or thresholds before changing instructions.
