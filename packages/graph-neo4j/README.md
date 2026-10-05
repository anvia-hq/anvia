# @anvia/neo4j

Build GraphRAG applications on Neo4j with typed schemas, document ingestion, and
retrieval that follows connected entities back to their source evidence.

## Install

```sh
pnpm add @anvia/neo4j @anvia/graph @anvia/core @anvia/openai zod
```

Requires Neo4j 2026.01 or newer. `@anvia/openai` supplies the example's models.

## Quickstart

Set `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `OPENAI_API_KEY`.

```ts
import { defineGraphSchema, ingestGraphText } from "@anvia/graph";
import { Neo4jClient } from "@anvia/neo4j";
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
const client = new Neo4jClient({
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
      chunks: { vector: { name: "support_chunks", dimensions: 1536, similarity: "cosine" } },
      entities: { vector: { name: "support_entities", dimensions: 1536, similarity: "cosine" } },
    },
  },
});

try {
  await graph.ensure({ indexTimeoutMs: 60_000 });
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

Tenant handles scope managed graph operations in shared resources. They are not a database
authorization boundary. Existing graph registrations are read-only.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/graph-neo4j.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
