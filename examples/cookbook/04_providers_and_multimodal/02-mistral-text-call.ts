import { Agent } from "@anvia/core/agent";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({
  apiKey: process.env.MISTRAL_API_KEY,
});

const agentModel = client.completionModel("mistral-large-latest");

const agent = new Agent({
  id: "mistral-agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.generate({ prompt: "Explain what a context-aware agent does." });

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
