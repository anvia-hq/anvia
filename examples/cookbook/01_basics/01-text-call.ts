import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Provider clients create models; AgentBuilder composes model-independent behavior.
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("You are a concise assistant. Answer in two sentences or less.")
  .build();

const response = await agent.prompt("Explain what an agent framework does.").send();

console.log(response.output);
