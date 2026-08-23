import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

type KnowledgeNote = {
  id: string;
  title: string;
  body: string;
  topic: string;
};

const notes: KnowledgeNote[] = [
  {
    id: "market-brief",
    title: "Market brief",
    body: "Market volatility increased after a policy surprise.",
    topic: "finance",
  },
  {
    id: "support-brief",
    title: "Support brief",
    body: "Support requests increased after the new onboarding flow.",
    topic: "product",
  },
];

const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: notes,
  id: (note) => note.id,
  content: (note) => `${note.title}\n${note.body}`,
  metadata: (note) => ({ topic: note.topic }),
});

const store = InMemoryVectorStore.fromDocuments({ documents: embedded });
const results = await retrieveDocuments({
  store,
  model: embeddingModel,
  query: "market risk",
  topK: 1,
});

console.log(results);
