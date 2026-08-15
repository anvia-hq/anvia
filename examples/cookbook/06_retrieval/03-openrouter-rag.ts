import { Agent, createVectorContext } from "@anvia/core/agent";
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { createTransformersEmbeddingModel } from "@anvia/transformers";

type PolicyNote = {
  id: string;
  text: string;
};

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
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

const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: notes,
  id: (note) => note.id,
  content: (note) => note.text,
});
const store = InMemoryVectorStore.fromDocuments({ documents: embedded });

const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Answer using the retrieved policy context. If context is thin, say so.",
  context: [createVectorContext({ store, model: embeddingModel, topK: 1 })],
});

const response = await agent.generate("What should I do for a security incident?");

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
