# @anvia/pinecone

Store and search Anvia documents in Pinecone. Pair the store with your choice of
embedding model to add semantic retrieval to agents and applications.

## Install

```sh
pnpm add @anvia/pinecone @anvia/core @anvia/openai
```

`@anvia/openai` supplies the embedding model in this example; other embedding adapters work too.

## Quickstart

Use Node.js 22 or later and set `PINECONE_API_KEY` and `OPENAI_API_KEY`.
Choose a serverless region available to your Pinecone account.

```ts
import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { PineconeVectorClient } from "@anvia/pinecone";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const model = openai.embeddingModel({ modelId: "text-embedding-3-small" });
const client = new PineconeVectorClient({ apiKey: process.env.PINECONE_API_KEY! });
const store = client.vectorStore<{ id: string; text: string }>({
  indexName: "support-docs",
  spec: { serverless: { cloud: "aws", region: "us-east-1" } },
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

Set `namespace` to organize vectors within an index. New indexes need a serverless or BYOC
`spec`; the adapter uses Pinecone SDK 9. Indexing may take time before new writes appear in search.

Pass `client` to use a preconfigured native SDK client. Injected clients remain caller-owned.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/vector-pinecone.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
