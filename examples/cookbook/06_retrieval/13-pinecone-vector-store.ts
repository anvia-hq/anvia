import { embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { PineconeVectorStore } from "@anvia/pinecone";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type MarketNote = {
  id: string;
  text: string;
  sector: string;
};

requireEnv("PINECONE_API_KEY");

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

const store = await PineconeVectorStore.connect<MarketNote>({
  indexName: requireEnv("PINECONE_INDEX_NAME"),
  namespace: process.env.PINECONE_NAMESPACE ?? "anvia-cookbook",
  createIfMissing: false,
});
await store.upsertDocuments(embedded);

const results = await store.index(embeddingModel).search({
  query: "technology demand",
  topK: 2,
  filter: vectorFilter.eq("sector", "technology"),
});

console.log(results);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
