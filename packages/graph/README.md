# @anvia/graph

Provider-neutral schema, extraction, retrieval-context, and tool primitives for knowledge graphs.

```ts
import { defineGraphSchema, extractGraphFacts } from "@anvia/graph";
import { z } from "zod";

const schema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product or service.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
  },
  relationships: {},
});

const facts = await extractGraphFacts({ model, schema, chunks });
```

Database provisioning, persistence, and query execution belong to graph adapter packages such as
`@anvia/neo4j` and `@anvia/memgraph`.

## Ingestion

Managed graphs accept the same raw text document shape as vector ingestion:

```ts
import { ingestGraphText } from "@anvia/graph";

const ingestion = await ingestGraphText({
  graph,
  document: {
    id: "incident-42",
    text,
    metadata: { tenant: "acme" },
  },
  extractionModel,
  embeddingModel,
  chunking: {
    strategy: "recursive",
    maxSize: 1_000,
    overlap: 100,
    separators: ["\n\n", "\n", " "],
  },
  conflict: "error",
  orphanEntities: "delete",
});
```

Use `ingestGraphDocuments()` for a batch. Both functions extract facts, embed chunks and entities,
and atomically replace each source document in the managed graph. Existing graph registrations are
read-only and are rejected as ingestion targets by TypeScript.

The result also exposes `vectorDocuments`, grouped by source document ID, so a vector store can
reuse the chunk embeddings without another model call:

```ts
await vectorStore.upsert({ documents: ingestion.vectorDocuments });
```

The graph and vector writes are separate transactions. Applications that require cross-store
reconciliation should persist their own ingestion status and retry the incomplete write. Advanced
callers can use `prepareGraphDocuments()` to run chunking, extraction, and embedding without writing,
then pass its graph fields to `graph.replaceDocuments()` and its `vectorDocuments` to a vector store.

## Search tool

Create the same Agent tool for any graph adapter implementing `GraphContextRetriever`:

```ts
import { createGraphSearchTool } from "@anvia/graph";

const searchGraph = createGraphSearchTool({
  name: "search_graph",
  description: "Search connected entities and supporting evidence.",
  graph,
  model: embeddingModel,
  search: {
    type: "vector",
    seeds: ["entities"],
    topK: 8,
  },
  traversal: {
    relationships: ["AFFECTS"],
    direction: "both",
    maxDepth: 2,
    maxNodes: 40,
    maxRelationships: 80,
  },
  evidence: { type: "chunks", maxChunks: 12 },
});
```

The graph registration controls which evidence modes are valid. Managed graphs can hydrate stored
chunks, while existing graph registrations use `{ type: "none" }`.

## Exploration

Adapters implementing `GraphExplorer` expose a portable, bounded view for visualization:

```ts
const overview = await graph.explore({
  mode: "overview",
  nodeTypes: ["Product"],
  maxNodes: 100,
  maxRelationships: 200,
});

const neighborhood = await graph.explore({
  mode: "expand",
  nodeIds: [overview.nodes[0]!.id],
  direction: "both",
  maxDepth: 1,
});
```

Explorer IDs are opaque and provider-specific. They are intended for follow-up expansion within the
same graph, not persistence or cross-provider migration. Adapters cap overview and expansion requests,
return truncation metadata, and omit reserved Anvia properties such as stored embeddings.
