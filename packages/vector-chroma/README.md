# @anvia/chroma

Store and search Anvia documents in ChromaDB. Pair the store with your choice of
embedding model to add semantic retrieval to agents and applications.

## Install

```sh
pnpm add @anvia/chroma @anvia/core @anvia/openai
```

`@anvia/openai` supplies the embedding model in this example; other embedding adapters work too.

## Quickstart

Start Chroma at `http://localhost:8000` and set `OPENAI_API_KEY`.

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { ChromaVectorClient } from "@anvia/chroma";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.embeddingModel({ modelId: "text-embedding-3-small" });
const client = new ChromaVectorClient({ path: "http://localhost:8000" });
const store = client.vectorStore<{ id: string; text: string }>({
  collectionName: "support_docs",
  dimensions: 1536,
  metric: "cosine",
});

try {
  await store.ensure();
  const { documents } = await embedDocuments({
    model,
    documents: [{ id: "password-reset", text: "Reset links expire after 30 minutes." }],
    id: (document) => document.id,
    content: (document) => document.text,
  });
  await store.upsert({ documents });

  const results = await retrieveDocuments({
    store,
    model,
    query: "How long does a reset link last?",
    topK: 3,
  });
  console.log(results);
} finally {
  await client.close();
}
```

## Store capabilities

- Explicit provisioning with `ensure()` and readiness checks with `validate()`.
- Document replacement, vector search, and metadata filtering.
- Bring your own embedding model; `store.search()` accepts vectors directly.

Use `configuration` and `metadata` to customize collection provisioning.

Pass `client` to use a preconfigured native SDK client. Injected clients remain caller-owned.

## Learn more

- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
