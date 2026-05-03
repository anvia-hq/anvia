import { AgentBuilder } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type PolicyNote = {
  id: string;
  text: string;
};

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const embeddingModel = await createTransformersEmbeddingModel();
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

const embedded = await embedDocuments(embeddingModel, notes, {
  id: (note) => note.id,
  content: (note) => note.text,
});
const index = InMemoryVectorStore.fromDocuments(embedded).index(embeddingModel);

const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Answer using the retrieved policy context. If context is thin, say so.")
  .dynamicContext(index, { topK: 1 })
  .build();

const response = await agent.prompt("What should I do for a security incident?").send();

console.log(response.output);
