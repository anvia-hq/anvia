import { ChromaVectorStore } from "@anvia/chroma";
import { embedDocuments } from "@anvia/core/embeddings";
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
  content: (note) => note.text,
  metadata: (note) => ({ sector: note.sector }),
});

const store = await ChromaVectorStore.connect<MarketNote>({
  collectionName: "aion_market_notes",
});
await store.upsertDocuments(embedded);

const results = await store.index(embeddingModel).search({
  query: "technology demand",
  topK: 2,
});

console.log(results);
