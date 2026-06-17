import { embedDocuments } from "@anvia/core/embeddings";
import { MilvusVectorStore } from "@anvia/milvus";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type MarketNote = {
  id: string;
  text: string;
  sector: string;
};

const embeddingModel = await createTransformersEmbeddingModel();
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

const embedded = await embedDocuments(embeddingModel, notes, {
  id: (note) => note.id,
  content: (note) => `${note.sector}: ${note.text}`,
});

const store = await MilvusVectorStore.connect<MarketNote>({
  collectionName: "anvia_market_notes",
  vectorSize: 384,
});
await store.upsertDocuments(embedded);

const results = await store.index(embeddingModel).search({
  query: "technology demand",
  topK: 2,
});

console.log(results);
