# @anvia/graph

Turn text into typed entities and relationships for GraphRAG. Define a graph schema once,
then use it for extraction, retrieval tools, and ingestion with Neo4j or Memgraph.

## Install

```sh
pnpm add @anvia/graph @anvia/core @anvia/openai zod
```

`@anvia/openai` supplies the extraction model below; other completion adapters work too.

## Quickstart

Set `OPENAI_API_KEY`. This example extracts graph facts without requiring a graph database.

```ts
import { defineGraphSchema, extractGraphFacts } from "@anvia/graph";
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
const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const facts = await extractGraphFacts({
  model: client.completionModel({ modelId: "gpt-5.6", api: "responses" }),
  schema,
  chunks: [
    {
      id: "chunk-1",
      documentId: "products",
      index: 0,
      text: "The product with ID anvia is named Anvia.",
    },
  ],
});
console.log(facts.output.entities);
```

## Build on the same schema

- Ingest documents with chunking, extraction, and embeddings into managed graphs.
- Reuse chunk embeddings in vector stores and track partial writes with ingestion receipts.
- Resolve extraction conflicts with explicit property policies.
- Create bounded graph search tools and explore graph neighborhoods.

Persistence and provisioning belong to [Neo4j](https://github.com/anvia-hq/anvia/blob/main/packages/graph-neo4j/README.md)
and [Memgraph](https://github.com/anvia-hq/anvia/blob/main/packages/graph-memgraph/README.md).
Property schemas must use `z.strictObject()` and preserve input values without transforms or defaults.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/graph.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
