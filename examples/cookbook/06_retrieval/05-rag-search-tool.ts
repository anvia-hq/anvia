import { ChromaVectorStore } from "@anvia/chroma";
import { Agent } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { OpenAIClient } from "@anvia/openai";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type Runbook = {
  id: string;
  text: string;
};

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const embeddingModel = await createTransformersEmbeddingModel();
const runbooks: Runbook[] = [
  {
    id: "database-latency",
    text: "For database latency, inspect connection pool saturation and slow queries.",
  },
  {
    id: "queue-backlog",
    text: "For queue backlog, compare producer rate, worker concurrency, and retry volume.",
  },
];

const embedded = await embedDocuments(embeddingModel, runbooks, {
  id: (runbook) => runbook.id,
  content: (runbook) => runbook.text,
});
const store = await ChromaVectorStore.connect<Runbook>({
  collectionName: "anvia_runbooks",
});
await store.upsertDocuments(embedded);

const searchRunbooks = store.index(embeddingModel).asTool({
  name: "search_runbooks",
  description: "Search incident runbooks for relevant operational guidance.",
  topK: 2,
});

const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use the runbook search tool before answering incident questions.",
  maxTurns: 2,
  tools: [searchRunbooks],
});

const response = await agent.generate("The queue is backing up. What should I check?");

console.log(response.output);
