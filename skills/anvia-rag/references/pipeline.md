# Chunk and Embed Pipeline

## Chunk

`chunkText` from `@anvia/core/documents` splits raw text before embedding. Keep
chunk ids stable and traceable to the source:

```ts
import { chunkText } from "@anvia/core/documents";
import type { Document } from "@anvia/core/completion";

const chunks = chunkText({
  text,
  strategy: "recursive",
  maxSize: 80,
  overlap: 10,
  separators: ["\n\n", "\n", " "],
}).map((chunk): Document => ({
  id: `${path}#chunk=${chunk.index}`,
  text: chunk.text,
  additionalProps: {
    source: path,
    mediaType: "text/plain",
    chunkIndex: String(chunk.index),
  }),
}));
```

Small overlap preserves cross-boundary context. Record provenance
(`source`, `mediaType`, `chunkIndex`) in `additionalProps` — retrieval results
are only as citable as the metadata you store.

## Embed

`embedDocuments` from `@anvia/core/embeddings` maps domain objects to embedded
documents with explicit selectors. The same model instance must embed documents
and queries:

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

const model = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const { documents: embedded } = await embedDocuments({
  model,
  documents: reports,
  id: (report) => report.id,
  content: (report) => report.text,
  metadata: (report) => ({ desk: report.desk, priority: report.priority }),
});
```

- `id` must be stable across re-index runs or upserts will duplicate.
- `content` is what gets embedded — keep titles with bodies, drop boilerplate.
- `metadata` carries everything you will filter or display on (`desk`,
  `priority`, `source`). You cannot filter on what you did not store.
- Custom models implement `EmbeddingModel` (`provider`, `modelId`,
  `dimensions`, `embedTexts`). Production embeddings can also come from
  provider packages (e.g. Mistral) — same `embedDocuments` contract.

## Retrieve

```ts
import { InMemoryVectorStore, retrieveDocuments, vectorFilter } from "@anvia/core/vector-store";

const store = InMemoryVectorStore.fromDocuments({
  documents: embedded,
  index: { type: "lsh", numTables: 8, numHyperplanes: 1, seed: 11 }, // opt-in for scale
});
const results = await retrieveDocuments({
  store,
  model,
  query: "earnings risk remains elevated",
  topK: 3,
  filter: vectorFilter.and(vectorFilter.eq("desk", "markets"), vectorFilter.gt("priority", 2)),
});
```

Start with exact retrieval (`topK`, metadata filters) before adding approximate
indexes — LSH trades recall for speed and needs a fixed `seed` for reproducible
evals.
