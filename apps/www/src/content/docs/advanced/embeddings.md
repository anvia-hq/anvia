---
title: Embeddings
description: Embed text and documents for retrieval workflows.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 31
---

Embeddings turn text into vectors so retrieval can compare a user query with prepared knowledge. In core, the embedding model is just an interface:

```ts
import type { EmbeddingModel } from "@anvia/core/embeddings";

const embeddingModel: EmbeddingModel = {
  dimensions: 1536,
  maxBatchSize: 128,
  async embedTexts(texts) {
    return provider.embed(texts);
  },
};
```

Provider packages and adapter packages can implement this interface. The retrieval code only needs `embedTexts(...)`.

## Embed One Or Many Strings

Use `embedText(...)` for a single query and `embedTexts(...)` for plain batches:

```ts
import { embedText, embedTexts } from "@anvia/core/embeddings";

const queryEmbedding = await embedText(embeddingModel, "refund policy");
const textEmbeddings = await embedTexts(embeddingModel, [
  "Refunds are reviewed within two business days.",
  "Password reset links expire after 30 minutes.",
]);
```

`embedTexts(...)` respects `model.maxBatchSize` and preserves the input order. It throws if the provider returns a different number of embeddings than requested.

## Embed Documents

Most retrieval ingestion should use `embedDocuments(...)`:

```ts
import { embedDocuments } from "@anvia/core/embeddings";

type Article = {
  slug: string;
  title: string;
  body: string;
  product: string;
  published: boolean;
};

const embedded = await embedDocuments(embeddingModel, articles, {
  id: (article) => article.slug,
  content: (article) => `${article.title}\n${article.body}`,
  metadata: (article) => ({
    product: article.product,
    published: article.published,
    title: article.title,
  }),
});
```

The original document stays attached to each embedded result. Metadata is stored separately so vector stores can filter before results are returned.

## Multiple Embeddings Per Document

Return an array from `content(...)` when one document should be searchable by several chunks but still return as one logical record:

```ts
const embedded = await embedDocuments(embeddingModel, runbooks, {
  id: (runbook) => runbook.id,
  content: (runbook) => runbook.sections.map((section) => section.text),
  metadata: (runbook) => ({
    service: runbook.service,
    severity: runbook.severity,
  }),
});
```

A vector search scores each stored document by its best matching embedding. Use this for page sections, article sections, or generated summaries that should all point back to the same source record.

If each chunk needs its own citation, create separate documents instead:

```ts
const chunks = articles.flatMap((article) =>
  splitIntoChunks(article.body).map((text, index) => ({
    id: `${article.slug}#chunk=${index}`,
    text,
    title: article.title,
    source: article.slug,
  })),
);
```

## Concurrency

Use the `concurrency` option for ingestion jobs:

```ts
const embedded = await embedDocuments(embeddingModel, documents, {
  id: (document) => document.id,
  content: (document) => document.text,
  concurrency: 2,
});
```

Start conservatively. Higher concurrency can improve backfill speed, but it can also trigger provider rate limits or overload local embedding models.

## Metadata Values

Vector metadata supports strings, numbers, booleans, and `null`. Avoid nested objects in metadata. If you need richer source information, keep it in your product database and store a stable id in vector metadata.

Good metadata usually answers these questions:

- who may retrieve this document
- which tenant, product, or workspace owns it
- which source file or record it came from
- whether it is published, archived, internal, or public
- when it was last updated, if freshness matters

Do not embed secrets and then rely on prompt instructions to hide them. Redact or exclude sensitive content before embedding.

## Vector Math Helpers

Core also exports basic vector math helpers:

```ts
import {
  angularDistance,
  cosineSimilarity,
  dotProduct,
  euclideanDistance,
} from "@anvia/core/embeddings";
```

Use these in tests, custom stores, diagnostics, or evaluation code. The in-memory store uses cosine similarity for document search.
