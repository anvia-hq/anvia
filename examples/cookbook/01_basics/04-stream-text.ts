import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("You are a concise assistant.")
  .build();

// Streaming yields normalized events; text_delta contains the visible answer text.
for await (const event of agent.prompt("Write a short haiku about TypeScript agents.").stream()) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    process.stdout.write("\n");
    console.log(event.usage);
  }
}
