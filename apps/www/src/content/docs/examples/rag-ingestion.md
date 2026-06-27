---
title: RAG Ingestion
description: A complete ingestion flow from source documents to Chroma-backed retrieval.
section: examples
sidebar:
  group: Knowledge Patterns
  order: 1
---

RAG ingestion turns source material into searchable evidence. A useful ingestion example should show the whole path: load source documents, OCR scanned files, normalize text, chunk with stable ids, embed, write to a vector store, and record what changed.

## Scenario

Support knowledge comes from three places: published CMS articles, text-based PDFs, and scanned warranty forms. The support agent should retrieve only published checkout policy for the caller's tenant and cite the source title or page.

## Flow

| Step | Anvia surface | App-owned boundary |
| --- | --- | --- |
| load text sources | CMS client, `PdfFileLoader` | source permissions, draft filtering, source ids |
| OCR scanned files | `MistralClient().ocrModel()` | upload validation, source metadata, retry policy |
| normalize and chunk | app code | stable chunk ids, deleted-source handling |
| embed | OpenAI `embeddingModel("text-embedding-3-small")` | batching, rate limits, redaction |
| store | `ChromaVectorStore.upsertDocuments(...)` | collection ownership and refresh policy |
| serve retrieval | `store.index(embeddings)` | tenant/product filters and freshness checks |

## Example

```ts
import { readFile } from "node:fs/promises";
import { embedDocuments } from "@anvia/core/embeddings";
import { PdfFileLoader, pdfPageLoaderToDocuments } from "@anvia/core/loaders";
import { ChromaVectorStore } from "@anvia/chroma";
import { MistralClient } from "@anvia/mistral";
import { OpenAIClient } from "@anvia/openai";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });

const embeddings = openai.embeddingModel("text-embedding-3-small");
const ocr = mistral.ocrModel();

export async function refreshSupportKnowledge(input: RefreshKnowledgeInput) {
  const cmsDocs = await input.cms.listPublishedArticles({
    tenantId: input.tenantId,
    productArea: "checkout",
  });

  const pdfPages = await pdfPageLoaderToDocuments(
    PdfFileLoader.withGlob("knowledge/support/**/*.pdf").readWithPath().byPage().ignoreErrors(),
  );

  const scannedDocs = await Promise.all(
    input.scannedFiles.map(async (file) => {
      const result = await ocr.ocr({
        source: {
          type: "bytes",
          data: await readFile(file.path),
          filename: file.filename,
        },
        tableFormat: "markdown",
        includeImageBase64: false,
      });

      return result.pages.map((page) => ({
        id: `${file.id}#page=${page.index}`,
        title: file.title,
        text: page.markdown,
        source: file.path,
        pageNumber: page.index,
        tenantId: input.tenantId,
        productArea: "checkout",
        visibility: "public",
        updatedAt: file.updatedAt,
      }));
    }),
  );

  const sourceDocuments = [
    ...cmsDocs.map((article) => ({
      id: article.id,
      title: article.title,
      text: `${article.title}\n${article.body}`,
      source: `cms:${article.id}`,
      tenantId: article.tenantId,
      productArea: article.productArea,
      visibility: article.visibility,
      updatedAt: article.updatedAt,
    })),
    ...pdfPages.map((page) => ({
      id: page.id,
      title: page.additionalProps?.source ?? page.id,
      text: page.text,
      source: page.additionalProps?.source ?? page.id,
      pageNumber: Number(page.additionalProps?.pageNumber ?? 0),
      tenantId: input.tenantId,
      productArea: "checkout",
      visibility: "public",
      updatedAt: input.refreshStartedAt,
    })),
    ...scannedDocs.flat(),
  ];

  const chunks = sourceDocuments.flatMap((document) =>
    splitIntoChunks(document.text).map((chunk, index) => ({
      id: `${document.id}#chunk=${index}`,
      text: chunk.text,
      sourceId: document.id,
      title: document.title,
      source: document.source,
      pageNumber: document.pageNumber,
      tenantId: document.tenantId,
      productArea: document.productArea,
      visibility: document.visibility,
      updatedAt: document.updatedAt,
    })),
  );

  const embedded = await embedDocuments(embeddings, chunks, {
    id: (chunk) => chunk.id,
    content: (chunk) => chunk.text,
    metadata: (chunk) => ({
      sourceId: chunk.sourceId,
      title: chunk.title,
      source: chunk.source,
      tenantId: chunk.tenantId,
      productArea: chunk.productArea,
      visibility: chunk.visibility,
      updatedAt: chunk.updatedAt,
      ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
    }),
    concurrency: 2,
  });

  const store = await ChromaVectorStore.connect({
    collectionName: "support_knowledge",
  });

  await store.upsertDocuments(embedded);

  await input.ingestionLog.record({
    tenantId: input.tenantId,
    sourceCount: sourceDocuments.length,
    chunkCount: chunks.length,
    collection: "support_knowledge",
    refreshedAt: input.refreshStartedAt,
  });

  return store.index(embeddings);
}
```

`splitIntoChunks(...)` is application code. Keep chunk ids stable across refreshes so updates replace old chunks instead of leaving duplicate stale evidence.

## Metadata That Matters

| Metadata | Why |
| --- | --- |
| `tenantId` | prevents cross-tenant retrieval |
| `visibility` | keeps drafts and private docs out of public agents |
| `productArea` | limits checkout questions to checkout policy |
| `sourceId` and `source` | connects answers to source records and files |
| `title` and `pageNumber` | supports citations and debugging |
| `updatedAt` | helps detect stale answers |

## Swap Points

| Part | Default in this example | Common swaps |
| --- | --- | --- |
| OCR | Mistral OCR | provider OCR, custom parser, manual review queue |
| embeddings | OpenAI `text-embedding-3-small` | Gemini, Mistral, FastEmbed, Transformers |
| vector store | Chroma | pgvector, Qdrant, Pinecone, Redis, LanceDB, Milvus, Weaviate |
| source loading | CMS + PDF loader + OCR | object storage, uploads, database records |

## Failure Modes

- OCR output is embedded without source/page metadata.
- Draft, private, or cross-tenant documents are embedded into the public index.
- Deleted sources are not removed or tombstoned in the retrieval collection.
- Chunk ids change every refresh, causing duplicate stale chunks.
- Ingestion runs in the prompt path instead of a worker or admin refresh.

## Next Patterns

- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Document Grounding](/docs/examples/document-grounding)
- [Pipeline Worker](/docs/examples/pipeline-worker)
