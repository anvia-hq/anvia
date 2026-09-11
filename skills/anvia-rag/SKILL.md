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
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: notes,
  id: (note) => note.id,
  content: (note) => `${note.title}\n${note.body}`,
  metadata: (note) => ({ topic: note.topic }),
});

const store = InMemoryVectorStore.fromDocuments({ documents: embedded });
const results = await retrieveDocuments({
  store,
  model: embeddingModel,
  query: "market risk",
  topK: 1,
});
```

## Output

Keep the pipeline explicit: load → chunk → embed → upsert → retrieve. Point to
the relevant reference file instead of pasting its contents into chat.
