---
title: "@anvia/transformers: Examples"
description: "Small examples that show @anvia/transformers at the package boundary."
section: packages
sidebar:
  group: "@anvia/transformers"
  order: 4
  label: "Examples"
---
## Minimal embeddings

```ts
import { createTransformersEmbeddingModel } from "@anvia/transformers";

const embeddingModel = await createTransformersEmbeddingModel();
const vectors = await embeddingModel.embedTexts([
  "Password reset links expire after 30 minutes.",
]);

console.log(vectors[0]?.values.length);
```
## Product-shaped ingestion

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

const embeddingModel = await createTransformersEmbeddingModel({ maxBatchSize: 32 });

export async function embedSupportArticles(articles: SupportArticle[]) {
  return embedDocuments(embeddingModel, articles, {
    id: (article) => article.id,
    content: (article) => article.title + "\n" + article.body,
    metadata: (article) => ({
      product: article.product,
      updatedAt: article.updatedAt,
    }),
  });
}
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("embedding model", () => {
  it("returns one vector per input", async () => {
    const model = await createTransformersEmbeddingModel();
    const result = await model.embedTexts(["alpha", "beta"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.values.length).toBeGreaterThan(0);
  });
});
```
Run local embedding tests only where model download/runtime cost is acceptable. For normal app tests, mock the `EmbeddingModel` contract.
