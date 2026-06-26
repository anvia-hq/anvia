---
title: RAG Ingestion
description: The pattern for building and refreshing a retrieval index.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 1
---

RAG ingestion turns source documents into searchable evidence. The ingestion job should own source loading, chunking, metadata, embedding, storage, and refresh policy.

## Scenario

Support docs are edited in a CMS. The support agent should retrieve only published articles for the caller's product area.

## Example

```ts
export async function refreshSupportDocs(input: RefreshDocsInput) {
  const articles = await input.cms.listPublishedArticles();
  const records = [];

  for (const article of articles) {
    for (const chunk of chunkArticle(article)) {
      records.push({
        id: `${article.id}:${chunk.index}`,
        text: chunk.text,
        metadata: {
          articleId: article.id,
          title: article.title,
          productArea: article.productArea,
          visibility: article.visibility,
          updatedAt: article.updatedAt,
        },
      });
    }
  }

  const embeddings = await input.embeddingModel.embedTexts(records.map((record) => record.text));

  await input.vectorStore.upsert(
    records.map((record, index) => ({
      ...record,
      vector: embeddings[index].vector,
    })),
  );

  await input.ingestionLog.record({
    source: "support-cms",
    documentCount: articles.length,
    chunkCount: records.length,
  });
}
```

## Metadata That Matters

| Metadata | Why |
| --- | --- |
| `articleId` | cite and debug retrieved chunks |
| `productArea` | filter by current workflow |
| `visibility` | prevent draft/private content leaks |
| `updatedAt` | detect stale retrieval results |

## Failure Modes

- Ingestion mixes public and private content without metadata.
- Chunks cannot be traced back to source documents.
- Deleted docs remain in the index.
- The agent receives stale policy after a source update.

## Next Patterns

- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Document Grounding](/docs/examples/document-grounding)
