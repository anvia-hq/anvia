import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant.",
});

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
