---
title: "@anvia/redis: Examples"
description: "Small examples that show @anvia/redis at the package boundary."
section: packages
sidebar:
  group: "@anvia/redis"
  order: 4
  label: "Examples"
---
## Minimal search

```ts
import { RedisVectorStore } from "@anvia/redis";

const store = await RedisVectorStore.connect({
  indexName: "support_docs",
  keyPrefix: "support_docs:",
  vectorSize: 1536,
});
const index = store.index(embeddingModel);

const results = await index.search({
  query: "enterprise support",
  topK: 5,
});

console.log(results.map((result) => result.id));
```
## Retrieval inside an agent

```ts
import { AgentBuilder } from "@anvia/core";
import { RedisVectorStore } from "@anvia/redis";

const store = await RedisVectorStore.connect({
  indexName: "support_docs",
  keyPrefix: "support_docs:",
  vectorSize: 1536,
});
const index = store.index(embeddingModel);

const agent = new AgentBuilder("support", completionModel)
  .instructions("Answer from retrieved support documentation when it is relevant.")
  .dynamicContext(index, {
    topK: 4,
    threshold: 0.72,
  })
  .build();
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("retrieval index", () => {
  it("returns filtered ids", async () => {
    const index = store.index(embeddingModel);
    const matches = await index.searchIds({
      query: "password reset",
      topK: 3,
      filter: { product: "support" },
    });

    expect(matches.length).toBeLessThanOrEqual(3);
  });
});
```
Use integration tests with disposable collections, tables, or namespaces. For agent tests, inject a fake `VectorSearchIndex` so prompt behavior can be tested without a live database.
