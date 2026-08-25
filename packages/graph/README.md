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
