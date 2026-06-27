---
title: "@anvia/fastembed: Getting Started"
description: "Install @anvia/fastembed and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/fastembed"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/fastembed @anvia/core fastembed
```
## Minimum setup

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { createFastEmbedEmbeddingModel } from "@anvia/fastembed";

const embeddingModel = await createFastEmbedEmbeddingModel();

const documents = await embedDocuments(
  embeddingModel,
  [{ id: "password-reset", text: "Password reset links expire after 30 minutes." }],
  {
    id: (document) => document.id,
    content: (document) => document.text,
  },
);

const store = InMemoryVectorStore.fromDocuments(documents);
const index = store.index(embeddingModel);

const results = await index.search({
  query: "How long does a reset link last?",
  topK: 3,
});

console.log(results);
```
## Default model

Import `DEFAULT_FASTEMBED_EMBEDDING_MODEL` when the application needs to display or log the default embedding model. Pass an explicit model/options object to `createFastEmbedEmbeddingModel(...)` when dimensions, batching, pooling, or runtime behavior need to be controlled.

## Next step

Continue with [Usage Patterns](/docs/packages/fastembed/usage-patterns).
