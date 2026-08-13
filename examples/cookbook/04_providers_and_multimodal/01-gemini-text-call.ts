import { Agent } from "@anvia/core/agent";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});

const agentModel = client.completionModel("gemini-2.5-flash");

const agent = new Agent({
  id: "gemini-agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.generate("Explain what a context-aware agent does.");

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(response.output);
