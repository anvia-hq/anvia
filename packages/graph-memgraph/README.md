# @anvia/memgraph

Build GraphRAG applications on Memgraph with typed schemas, document ingestion, and
retrieval that follows connected entities back to their source evidence.

## Install

```sh
pnpm add @anvia/memgraph @anvia/graph @anvia/core @anvia/openai zod
```

Requires Memgraph 3.6 or newer. `@anvia/openai` supplies the example's models.

## Quickstart

Start Memgraph locally and set `OPENAI_API_KEY`. Set `MEMGRAPH_URI` and authentication
variables if your server uses a different address or requires credentials.

```ts
import { defineGraphSchema, ingestGraphText } from "@anvia/graph";
import { MemgraphClient } from "@anvia/memgraph";
import { OpenAIClient } from "@anvia/openai";
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
const models = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const client = new MemgraphClient({
  uri: process.env.MEMGRAPH_URI ?? "bolt://localhost:7687",
  auth: {
    username: process.env.MEMGRAPH_USERNAME ?? "",
    password: process.env.MEMGRAPH_PASSWORD ?? "",
  },
});
const graph = client.managedKnowledgeGraph({
  name: "support",
  schema,
  resources: {
    labels: { document: "SupportDocument", chunk: "SupportChunk", entity: "SupportEntity" },
    indexes: {
      chunks: { vector: { name: "support_chunks", dimensions: 1536, similarity: "cosine" } },
      entities: { vector: { name: "support_entities", dimensions: 1536, similarity: "cosine" } },
    },
  },
});

try {
  await graph.ensure();
  const result = await ingestGraphText({
    graph,
    document: { id: "products", text: "The product with ID anvia is named Anvia." },
    extractionModel: models.completionModel({ modelId: "gpt-5.6", api: "responses" }),
    embeddingModel: models.embeddingModel({ modelId: "text-embedding-3-small" }),
    conflict: "error",
    orphanEntities: "delete",
  });
  console.log(result.write);
} finally {
  await client.close();
}
```

## What you can build

- Managed graphs with explicit provisioning and document-scoped replacement.
- Vector and hybrid retrieval with bounded traversal and source chunk evidence.
- Agent search tools through `createGraphSearchTool()` from `@anvia/graph`.
- Bounded exploration and read-only registration of existing graphs.

Memgraph uses native vector indexes and Tantivy text search. Existing graph registrations are
read-only. Schemas are shared with Neo4j; connection and index configuration remain provider-specific.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/graph-memgraph.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
