# @anvia/transformers

Local Transformers.js embedding model adapter for Anvia.

## Installation

```sh
pnpm add @anvia/transformers @anvia/core @huggingface/transformers
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

const model = await createTransformersEmbeddingModel();
const { documents } = await embedDocuments({
  model,
  documents: [{ id: "password-reset", text: "Reset links expire after 30 minutes." }],
  id: (document) => document.id,
  content: (document) => document.text,
});

const store = InMemoryVectorStore.fromDocuments({ documents });
const results = await retrieveDocuments({
  store,
  model,
  query: "How long does a reset link last?",
  topK: 3,
});
```

The default model is `Xenova/all-MiniLM-L6-v2`. Embedding helpers use object arguments, return
named results, and accept `retries` and `abortSignal`.

```ts
const model = await createTransformersEmbeddingModel({
  model: "Xenova/all-MiniLM-L6-v2",
  pooling: "mean",
  normalize: true,
  maxBatchSize: 16,
});
```

## Development

```sh
pnpm --filter @anvia/transformers typecheck
pnpm --filter @anvia/transformers test
pnpm --filter @anvia/transformers build
```
