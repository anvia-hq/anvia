import { Agent, createVectorContext } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { loadTransformersEmbeddingModel } from "@anvia/transformers";

type PolicyNote = {
  id: string;
  text: string;
};

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const embeddingModel = await loadTransformersEmbeddingModel({ modelId: "Xenova/all-MiniLM-L6-v2" });
const notes: PolicyNote[] = [
  {
    id: "refunds",
    text: "Refund requests over 30 days require manager approval.",
  },
  {
    id: "security",
    text: "Security incidents must be escalated to the incident commander.",
  },
];

const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: notes,
  id: (note) => note.id,
  content: (note) => note.text,
});
const store = InMemoryVectorStore.fromDocuments({ documents: embedded });

const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Answer using the retrieved policy context. If context is thin, say so.",
  context: [createVectorContext({ store, model: embeddingModel, topK: 1 })],
});

const response = await agent.generate({ prompt: "What should I do for a security incident?" });

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
