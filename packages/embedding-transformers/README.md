# @anvia/transformers

Generate text embeddings locally with Transformers.js. Build semantic search and retrieval
workflows without sending document text to a hosted embedding service.

## Install

```sh
pnpm add @anvia/transformers @anvia/core
```

## Quickstart

The first load may download model files. Subsequent loads can reuse the local cache.

```ts
import { createVectorIndex } from "@anvia/core/vector-store";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const model = await loadTransformersEmbeddingModel();

try {
  const index = createVectorIndex({ model });
  await index.ingest({ id: "password-reset", text: "Reset links expire after 30 minutes." });

  const results = await index.retrieve("How long does a reset link last?", { topK: 3 });
  console.log(results);
} finally {
  await model.close();
}
```

## What it supports

- Configurable pooling, normalization, batching, device, and dtype.
- Model caching and local-files-only loading.
- Existing Transformers pipelines through `adaptTransformersEmbeddingModel()`.
- Explicit cleanup with `close()` or `await using` for loaded models.

Reuse the model across requests. Adapted pipelines remain caller-owned; loaded models wait
for active inference before disposing their runtime.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/embedding-transformers.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
