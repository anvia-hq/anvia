import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

type KnowledgeDoc = {
  id: string;
  title: string;
  text: string;
  topic: string;
};

const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });

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

const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: docs,
  id: (doc) => doc.id,
  content: (doc) => `${doc.title}\n${doc.text}`,
  metadata: (doc) => ({ topic: doc.topic }),
});

const store = InMemoryVectorStore.fromDocuments({ documents: embedded });
const queries = [
  "Why are queries slow and the connection pool exhausted?",
  "What happens to stocks when yields move higher?",
  "Can I refund a customer after thirty days?",
];

for (const query of queries) {
  const results = await retrieveDocuments({ store, model: embeddingModel, query, topK: 2 });
  console.log(`\nQuery: ${query}`);
  for (const result of results) {
    console.log(`- ${result.id} score=${result.score.toFixed(3)} topic=${result.metadata?.topic}`);
  }
}
