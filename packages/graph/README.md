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
