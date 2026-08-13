import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

// Provider clients create models; Agent composes model-independent behavior.
const agentModel = client.completionModel("gpt-5.5");

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.generate("Explain what an agent framework does.");

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
