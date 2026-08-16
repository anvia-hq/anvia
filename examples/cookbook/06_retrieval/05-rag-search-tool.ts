import { ChromaVectorClient } from "@anvia/chroma";
import { Agent } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { createVectorSearchTool } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

type Runbook = {
  id: string;
  text: string;
};

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
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

const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: runbooks,
  id: (runbook) => runbook.id,
  content: (runbook) => runbook.text,
});
const vectorClient = new ChromaVectorClient();
const store = vectorClient.vectorStore<Runbook>({
  collectionName: "anvia_runbooks",
  dimensions: 384,
});
await store.ensure();
await store.upsert({ documents: embedded });

const searchRunbooks = createVectorSearchTool({
  store,
  model: embeddingModel,
  name: "search_runbooks",
  description: "Search incident runbooks for relevant operational guidance.",
  topK: 2,
});

const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use the runbook search tool before answering incident questions.",
  maxTurns: 2,
  tools: [searchRunbooks],
});

const response = await agent.generate({ prompt: "The queue is backing up. What should I check?" });

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
await vectorClient.close();
