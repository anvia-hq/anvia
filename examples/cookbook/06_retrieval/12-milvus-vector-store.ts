import { embedDocuments } from "@anvia/core/embeddings";
import { retrieveDocuments } from "@anvia/core/vector-store";
import { MilvusVectorClient } from "@anvia/milvus";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

type MarketNote = {
  id: string;
  text: string;
  sector: string;
};

const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const notes: MarketNote[] = [
  {
    id: "cloud",
    text: "Cloud infrastructure demand remained resilient into quarter end.",
    sector: "technology",
  },
  {
    id: "rates",
    text: "Rate-sensitive sectors traded lower after yields moved higher.",
    sector: "macro",
  },
];

const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: notes,
  id: (note) => note.id,
  content: (note) => `${note.sector}: ${note.text}`,
});

const client = new MilvusVectorClient();
const store = client.vectorStore<MarketNote>({
  collectionName: "anvia_market_notes",
  dimensions: 384,
});
await store.ensure();
await store.upsert({ documents: embedded });

const results = await retrieveDocuments({
  store,
  model: embeddingModel,
  query: "technology demand",
  topK: 2,
});

console.log(results);
await client.close();
