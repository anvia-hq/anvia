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

// readableStream() is useful when forwarding agent events from a web server.
const stream = agent
  .prompt("Give three short reasons to use AsyncIterable for streaming.")
  .readableStream();

const reader = stream.getReader();
const decoder = new TextDecoder();

while (true) {
  const result = await reader.read();
  if (result.done) {
    break;
  }

  process.stdout.write(decoder.decode(result.value));
}
