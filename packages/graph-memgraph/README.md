# @anvia/memgraph

Schema-first GraphRAG and graph retrieval for Memgraph 3.6 and newer.

## Installation

```sh
pnpm add @anvia/graph @anvia/memgraph @anvia/core
```

## Managed knowledge graph

```ts
import { createGraphSearchTool, defineGraphSchema, ingestGraphText } from "@anvia/graph";
import { MemgraphClient } from "@anvia/memgraph";
import { z } from "zod";

const schema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product or service.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
    Incident: {
      description: "An operational incident.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), title: z.string() }),
    },
  },
  relationships: {
    AFFECTS: {
      description: "An incident affects a product.",
      from: "Incident",
      to: "Product",
      properties: z.strictObject({ severity: z.enum(["low", "high"]) }),
    },
  },
});

await using client = new MemgraphClient({
  uri: process.env.MEMGRAPH_URI ?? "bolt://localhost:7687",
  auth: process.env.MEMGRAPH_USERNAME
    ? {
        username: process.env.MEMGRAPH_USERNAME,
        password: process.env.MEMGRAPH_PASSWORD!,
      }
    : undefined,
});

const graph = client.managedKnowledgeGraph({
  name: "support",
  schema,
  resources: {
    labels: {
      document: "SupportDocument",
      chunk: "SupportChunk",
      entity: "SupportEntity",
    },
    indexes: {
      chunks: {
        vector: {
          name: "support_chunks_vector",
          dimensions: 1536,
          similarity: "cosine",
          capacity: 100_000,
          scalarKind: "f16",
        },
        text: { name: "support_chunks_text" },
      },
      entities: {
        vector: {
          name: "support_entities_vector",
          dimensions: 1536,
          similarity: "cosine",
          capacity: 100_000,
        },
        text: {
          name: "support_entities_text",
          properties: ["id", "name", "title"],
        },
      },
    },
  },
});

await graph.ensure();

const ingestion = await ingestGraphText({
  graph,
  document: { id: "incident-42", text },
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

const searchGraph = createGraphSearchTool({
  name: "search_support_graph",
  description: "Search connected support incidents and products.",
  graph,
  model: embeddingModel,
  search: {
    type: "hybrid",
    seeds: ["chunks", "entities"],
    topK: 8,
    candidatesPerSeed: 20,
    rrfK: 60,
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

Managed graphs use Memgraph-native vector search, Tantivy text search, and bounded BFS traversal.
Vector index `capacity` defaults to `100_000`, `resizeCoefficient` to `2`, and `scalarKind` to
`"f32"` when omitted.

Memgraph vector indexes use `READ_UNCOMMITTED` visibility and text searches use their own index
snapshot. Anvia keeps provisioning queries in auto-commit sessions and document replacement or
deletion in explicit atomic transactions.

## Existing graph

Register application-owned resources without allowing Anvia to provision or mutate them:

```ts
const graph = client.knowledgeGraph({
  schema,
  seeds: {
    incidents: {
      nodeTypes: ["Incident"],
      vectorIndex: {
        name: "incident_vectors",
        property: "embedding",
        dimensions: 1536,
        similarity: "cosine",
      },
      textIndex: {
        name: "incident_text",
        properties: ["title"],
      },
    },
  },
});

await graph.validate();
```

## Graph explorer

Managed and existing graph registrations implement the shared bounded explorer contract:

```ts
const overview = await graph.explore({ mode: "overview", maxNodes: 100 });
const neighborhood = await graph.explore({
  mode: "expand",
  nodeIds: [overview.nodes[0]!.id],
  maxDepth: 1,
});
```

The explorer returns Memgraph internal IDs as opaque strings, limits every query, and omits
embeddings and other `__anvia_*` properties. Use stable graph identity properties for application
logic; use the opaque IDs only to expand the current view.

Existing registrations support `evidence: { type: "none" }`. Chunk evidence is available only for
managed graphs.

## Provider switching and data ownership

Schemas, extracted facts, retrieval options, context results, and graph-bound search tools are
shared with `@anvia/neo4j`. Switching a new deployment generally requires changing only the client
import and connection settings.

Anvia manages only resources created through `managedKnowledgeGraph()`. Moving existing graph data
between Neo4j and Memgraph remains application-owned. Re-ingest source documents for the cleanest
provider switch, or migrate data separately and register it with `knowledgeGraph()`.

Use `client.nativeDriver()` for application-owned Cypher. A supplied driver remains caller-owned;
a driver created from `uri` is closed with the client. Both clients support `await using`.

## Development

```sh
pnpm --filter @anvia/memgraph typecheck
pnpm --filter @anvia/memgraph test
ANVIA_MEMGRAPH_DOCKER_TESTS=1 pnpm --filter @anvia/memgraph test
pnpm --filter @anvia/memgraph build
```
