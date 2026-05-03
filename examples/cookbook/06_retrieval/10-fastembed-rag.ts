import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { createFastEmbedEmbeddingModel } from "@anvia/fastembed";

type KnowledgeDoc = {
  id: string;
  title: string;
  text: string;
  topic: string;
};

const embeddingModel = await createFastEmbedEmbeddingModel({
  model: "fast-bge-small-en-v1.5",
  maxBatchSize: 32,
});

const docs: KnowledgeDoc[] = [
  {
    id: "incident-db-latency",
    title: "Database latency runbook",
    text: "When database latency increases, inspect slow queries, lock contention, connection pool saturation, and replica lag.",
    topic: "incident-response",
  },
  {
    id: "market-rates",
    title: "Rates market note",
    text: "Long duration equities can trade lower when bond yields rise after inflation data surprises.",
    topic: "markets",
  },
  {
    id: "support-refunds",
    title: "Refund support policy",
    text: "Refunds older than 30 days require manager approval and documented customer context.",
    topic: "support",
  },
];

const embedded = await embedDocuments(embeddingModel, docs, {
  id: (doc) => doc.id,
  content: (doc) => `${doc.title}\n${doc.text}`,
  metadata: (doc) => ({ topic: doc.topic }),
});

const index = InMemoryVectorStore.fromDocuments(embedded).index(embeddingModel);
const queries = [
  "Why are queries slow and the connection pool exhausted?",
  "What happens to stocks when yields move higher?",
  "Can I refund a customer after thirty days?",
];

for (const query of queries) {
  const results = await index.search({ query, topK: 2 });
  console.log(`\nQuery: ${query}`);
  for (const result of results) {
    console.log(`- ${result.id} score=${result.score.toFixed(3)} topic=${result.metadata?.topic}`);
  }
}
