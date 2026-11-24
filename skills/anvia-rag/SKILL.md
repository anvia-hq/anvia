---
name: anvia-rag
description: Build retrieval and RAG with Anvia — chunking, embeddings, vector stores, knowledge graphs, filters, and search tools.
---

# Anvia RAG Skill

Use this skill when the user wants retrieval over their own data: chunking
documents, embedding them, picking a vector store, filtering results, or
exposing retrieval to an agent as a search tool.

## Process

1. Chunk and embed the corpus (`references/pipeline.md`).
2. Pick the store (`references/stores.md`) — `InMemoryVectorStore` first, a
   client store when data must persist. For connection questions, add a graph
   (`references/graph-rag.md`).
3. Expose retrieval to the agent (`references/rag-tool.md`, `references/graph-rag.md`) — search tool or
   `VectorContext`, not raw vectors in the prompt.
4. Run `scripts/check-rag.sh` from the app root before claiming done.

## Minimal slice

```ts
import { createVectorIndex } from "@anvia/core/vector-store";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const model = await loadTransformersEmbeddingModel();
const kb = createVectorIndex({
  model,
  chunking: { maxSize: 1_000, overlap: 100 },
});
await kb.ingest(notes);
const results = await kb.retrieve("market risk", { topK: 3, filter: { topic: "finance" } });
```

## Output

Keep the pipeline explicit: load → chunk → embed → upsert → retrieve. Point to
the relevant reference file instead of pasting its contents into chat.
