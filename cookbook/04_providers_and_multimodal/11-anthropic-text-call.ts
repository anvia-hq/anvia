import { AnthropicClient } from "@anvia/anthropic";
import { Agent } from "@anvia/core/agent";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  baseUrl: process.env.ANTHROPIC_BASEURL,
});

const agentModel = client.completionModel({
  modelId: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
});

const agent = new Agent({
  id: "anthropic-agent",
  model: agentModel,
  instructions: "You are a concise assistant. Answer in two sentences or less.",
});

const response = await agent.generate({ prompt: "Explain what a provider adapter does." });

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
