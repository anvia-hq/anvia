# @anvia/chroma

ChromaDB vector client and store adapter for Anvia.

## Installation

```sh
pnpm add @anvia/chroma @anvia/core chromadb
```

## Usage

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { ChromaVectorClient } from "@anvia/chroma";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const embeddings = openai.embeddingModel({ modelId: "text-embedding-3-small" });
const chroma = new ChromaVectorClient({ path: "http://localhost:8000" });
const store = chroma.vectorStore<{ id: string; text: string }>({
  collectionName: "support_docs",
  dimensions: 1536,
  metric: "cosine",
});

await store.ensure();

const { documents } = await embedDocuments({
  model: embeddings,
  documents: [{ id: "password-reset", text: "Reset links expire after 30 minutes." }],
  id: (document) => document.id,
  content: (document) => document.text,
});
await store.upsert({ documents });

const results = await retrieveDocuments({
  store,
  model: embeddings,
  query: "How long does a reset link last?",
  topK: 3,
});

await chroma.close();
```

Constructing a client or store performs no I/O. `ensure()` creates or validates the collection;
`validate()` only validates an existing collection. Search accepts raw vectors, while
`retrieveDocuments()` explicitly composes a store with an embedding model.

Pass `client` to `ChromaVectorClient` to inject a native client. Injected clients remain
caller-owned and are not closed by `close()`.

## Development

```sh
pnpm --filter @anvia/chroma typecheck
pnpm --filter @anvia/chroma test
pnpm --filter @anvia/chroma build
```
