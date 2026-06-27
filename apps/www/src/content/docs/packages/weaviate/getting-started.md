---
title: "@anvia/weaviate: Getting Started"
description: "Install @anvia/weaviate and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/weaviate"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/weaviate @anvia/core weaviate-client
```
## Minimum setup

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { WeaviateVectorStore } from "@anvia/weaviate";

const openai = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const embeddings = openai.embeddingModel("text-embedding-3-small");

const documents = await embedDocuments(
  embeddings,
  [{ id: "password-reset", text: "Password reset links expire after 30 minutes." }],
  {
    id: (document) => document.id,
    content: (document) => document.text,
    metadata: () => ({ product: "support" }),
  },
);

const store = await WeaviateVectorStore.connect({
  className: "SupportDocs",
  vectorSize: 1536,
});

await store.upsertDocuments(documents);

const index = store.index(embeddings);
const results = await index.search({
  query: "How long does a reset link last?",
  topK: 3,
  filter: { product: "support" },
});

console.log(results);
```
## Connection boundary

Create the store once during application startup or ingestion setup. The returned index should be passed to agents, tools, or retrieval helpers; database clients, collection names, credentials, and schema decisions should stay outside prompt construction.

## Next step

Continue with [Usage Patterns](/docs/packages/weaviate/usage-patterns).
