import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, vectorFilter } from "@anvia/core/vector-store";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type Report = {
  id: string;
  text: string;
  desk: string;
  priority: number;
};

const model = await createTransformersEmbeddingModel();
const reports: Report[] = [
  { id: "r1", text: "earnings outlook improved", desk: "markets", priority: 3 },
  { id: "r2", text: "support backlog increased", desk: "product", priority: 2 },
  { id: "r3", text: "earnings risk remains elevated", desk: "markets", priority: 5 },
];

const embedded = await embedDocuments(model, reports, {
  id: (report) => report.id,
  content: (report) => report.text,
  metadata: (report) => ({ desk: report.desk, priority: report.priority }),
});

const store = InMemoryVectorStore.fromDocuments(embedded, {
  index: { type: "lsh", numTables: 8, numHyperplanes: 1, seed: 11 },
});
const results = await store.index(model).search({
  query: "earnings risk remains elevated",
  topK: 3,
  filter: vectorFilter.and(vectorFilter.eq("desk", "markets"), vectorFilter.gt("priority", 2)),
});

console.log(results);
