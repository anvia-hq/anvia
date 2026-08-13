import { AnthropicClient } from "@anvia/anthropic";
import { Agent } from "@anvia/core/agent";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASEURL,
});

const agentModel = client.completionModel(
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
);

const agent = new Agent({
  id: "anthropic-agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.generate("Explain what a provider adapter does.");

console.log(response.output);
