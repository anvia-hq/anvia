import { AnthropicClient } from "@anvia/anthropic";
import { AgentBuilder } from "@anvia/core/agent";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASEURL,
});

const agentModel = client.completionModel(
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
);

const agent = new AgentBuilder("anthropic-agent", agentModel)
  .instructions("You are a concise assistant. Answer in two sentences or less.")
  .build();

const response = await agent.prompt("Explain what a provider adapter does.").send();

console.log(response.output);
