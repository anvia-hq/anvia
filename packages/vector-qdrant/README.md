# @anvia/qdrant

Store and search Anvia documents in Qdrant. Pair the store with your choice of
embedding model to add semantic retrieval to agents and applications.

## Install

```sh
pnpm add @anvia/qdrant @anvia/core @anvia/openai
```

`@anvia/openai` supplies the embedding model in this example; other embedding adapters work too.

## Quickstart

Start Qdrant at `http://localhost:6333` and set `OPENAI_API_KEY`.

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { QdrantVectorClient } from "@anvia/qdrant";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.embeddingModel({ modelId: "text-embedding-3-small" });
const client = new QdrantVectorClient({ url: "http://localhost:6333" });
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

Use `mode: "hybrid"` for dense and sparse retrieval. Tenant handles let multiple users
share a collection while scoping Anvia operations to one namespace.

Pass `client` to use a preconfigured native SDK client. Injected clients remain caller-owned.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/vector-qdrant.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
