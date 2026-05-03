import { AgentBuilder } from "@anvia/core/agent";
import { GeminiClient } from "@anvia/gemini";

const client = new GeminiClient({
  apiKey: process.env.GEMINI_API_KEY,
});

const agentModel = client.completionModel("gemini-2.5-flash");

const agent = new AgentBuilder("gemini-agent", agentModel)
  .instructions("You are a concise assistant. Answer in two sentences or less.")
  .build();

const response = await agent.prompt("Explain what a context-aware agent does.").send();

console.log(response.output);
