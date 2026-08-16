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
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const model = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
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

Loading is eager and may download model files. Reuse the returned handle and close it at application
shutdown. The handle supports `await using` and waits for active inference before disposing its
owned Transformers pipeline.

```ts
const model = await loadTransformersEmbeddingModel({
  modelId: "Xenova/all-MiniLM-L6-v2",
  pooling: "mean",
  normalize: true,
  maxBatchSize: 16,
});
```

```ts
await using model = await loadTransformersEmbeddingModel({
  modelId: "Xenova/all-MiniLM-L6-v2",
  device: "cpu",
  dtype: "q8",
  cacheDir: "./models",
});
```

Adapt an existing pipeline when the application owns its lifecycle:

```ts
import { adaptTransformersEmbeddingModel } from "@anvia/transformers";

const model = adaptTransformersEmbeddingModel({
  runtime: existingPipeline,
  modelId: "custom-model",
  pooling: "mean",
  normalize: true,
});
```

Adapted handles never dispose the caller-owned runtime. Embedding helpers use object arguments,
return named results, and accept `retries` and `abortSignal`.

## Development

```sh
pnpm --filter @anvia/transformers typecheck
pnpm --filter @anvia/transformers test
pnpm --filter @anvia/transformers build
```
