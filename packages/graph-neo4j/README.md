# @anvia/neo4j

Schema-first local GraphRAG for Neo4j 2026.01 and newer.

Provider-neutral schemas from `@anvia/graph` are accepted alongside the compatibility
`defineNeo4jGraphSchema()` API. Registered graphs expose `graph.retrieve()`, and the shared
`createGraphSearchTool()` factory gives Neo4j and Memgraph the same Agent tool API.

## Installation

```sh
pnpm add @anvia/graph @anvia/neo4j @anvia/core
```

## Managed knowledge graph

```ts
import { Agent } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { createGraphSearchTool } from "@anvia/graph";
import { Neo4jClient, defineNeo4jGraphSchema, extractGraphFacts } from "@anvia/neo4j";
import { z } from "zod";

const schema = defineNeo4jGraphSchema({
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

await using client = new Neo4jClient({
  uri: process.env.NEO4J_URI!,
  auth: {
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!,
  },
});
const graph = client.managedKnowledgeGraph({
  name: "support",
  schema,
  resources: {
    labels: { document: "SupportDocument", chunk: "SupportChunk", entity: "SupportEntity" },
    indexes: {
      chunks: {
        vector: { name: "support_chunks_vector", dimensions: 1536, similarity: "cosine" },
        fulltext: { name: "support_chunks_text" },
      },
      entities: {
        vector: { name: "support_entities_vector", dimensions: 1536, similarity: "cosine" },
        fulltext: { name: "support_entities_text", properties: ["id", "name", "title"] },
      },
    },
  },
});

await graph.ensure({ indexTimeoutMs: 60_000 });

const facts = await extractGraphFacts({ model: extractionModel, schema, chunks });
const [embeddedChunks, embeddedEntities] = await Promise.all([
  embedDocuments({
    model: embeddingModel,
    documents: chunks,
    id: (chunk) => chunk.id,
    content: (chunk) => chunk.text,
  }),
  embedDocuments({
    model: embeddingModel,
    documents: [...facts.output.entities],
    id: (entity) => entity.key,
    content: (entity) => formatEntity(entity),
  }),
]);

const write = await graph.replaceDocuments({
  documents,
  chunks: embeddedChunks.documents,
  entities: embeddedEntities.documents,
  relationships: facts.output.relationships,
  mentions: facts.output.mentions,
  conflict: "error",
  orphanEntities: "delete",
});
console.log(write);

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

const agent = new Agent({ id: "support", model: chatModel, tools: [searchGraph] });
```

The application owns file discovery, reading, chunking, entity embedding text, model loading,
retry policy, and Agent lifecycle. `extractGraphFacts()` performs model extraction but no writes.
`replaceDocuments()` performs one deterministic transaction but no model calls.

Graph property schemas must use `z.strictObject()` and must not coerce, default, transform,
preprocess, catch, trim, or otherwise overwrite values. This keeps extraction, comparison, and
stored Neo4j properties exact.

Re-ingestion is document-scoped. `replaceDocuments()` removes the old chunks and their provenance
before inserting the new representation. Facts supported by other documents remain. Use
`deleteDocuments({ documentIds, orphanEntities })` for explicit removal.

Both write operations return exact logical before-and-after counts for documents, chunks, entities,
relationships, and mentions. A resource is `created`, `updated`, `deleted`, or `unchanged` by its
stable public identity; the result is produced inside the same transaction as the mutation.

Retrieval always requires an explicit evidence mode. `{ type: "none" }` performs no evidence read.
Managed graphs can use `{ type: "chunks", maxChunks }` to hydrate exact source chunks in ranked
provenance order. Seeds, nodes, and relationships refer to those records through `sourceChunkIds`.

## Existing graph

```ts
const graph = client.knowledgeGraph({
  schema,
  seeds: {
    incidents: {
      nodeTypes: ["Incident"],
      vectorIndex: {
        name: "existing_incident_vectors",
        property: "embedding",
        dimensions: 1536,
        similarity: "cosine",
      },
      fulltextIndex: {
        name: "existing_incident_text",
        properties: ["title"],
      },
    },
    products: {
      nodeTypes: ["Product"],
      vectorIndex: {
        name: "existing_product_vectors",
        property: "embedding",
        dimensions: 1536,
        similarity: "cosine",
      },
      fulltextIndex: {
        name: "existing_product_text",
        properties: ["name"],
      },
    },
  },
});

await graph.validate();
```

## Graph explorer

Managed and existing graph registrations implement the shared `GraphExplorer` contract:

```ts
const overview = await graph.explore({ mode: "overview", maxNodes: 100 });
const neighborhood = await graph.explore({
  mode: "expand",
  nodeIds: [overview.nodes[0]!.id],
  maxDepth: 1,
});
```

The explorer returns Neo4j element IDs as opaque strings, limits every query, and omits embeddings
and other `__anvia_*` properties. Use stable graph identity properties for application logic; use the
opaque IDs only to expand the current view.

Existing registrations are read-only and expose no provisioning or write methods. Use
`client.nativeDriver()` for application-owned Cypher.

Existing graph registrations do not own Anvia document and chunk resources, so their retrieval and
tool registrations accept only `evidence: { type: "none" }`.

Each existing seed describes exactly one indexed node type and the complete expected vector and
full-text index definitions. Register additional node types as separate seeds and fuse them with
hybrid retrieval.

Package operations use explicit transactions and do not invoke Neo4j's managed retry APIs. Abort
signals roll back the active transaction. Applications decide whether and how to retry an entire
operation.

`Neo4jClient` supports `await using` and closes a driver that it creates from `uri` and `auth`.
When a caller supplies `driver`, that driver remains caller-owned; closing or disposing the client
only closes the Anvia client handle.

The public property boundary is intentionally JSON-safe. Unsafe Neo4j integers, temporal and
spatial objects, nodes, relationships, paths, maps, and heterogeneous property arrays are rejected
instead of being coerced.

## Development

```sh
pnpm --filter @anvia/neo4j typecheck
pnpm --filter @anvia/neo4j test
pnpm --filter @anvia/neo4j build
```
