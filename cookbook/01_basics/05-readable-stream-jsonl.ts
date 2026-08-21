import { Agent } from "@anvia/core/agent";
import { toReadableStream } from "@anvia/core/streaming";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant.",
});

// toReadableStream() is useful when forwarding agent events from a web server.
const stream = toReadableStream(
  agent.stream({ prompt: "Give three short reasons to use AsyncIterable for streaming." }),
);

const reader = stream.getReader();
const decoder = new TextDecoder();

while (true) {
  const result = await reader.read();
  if (result.done) {
    break;
  }

  process.stdout.write(decoder.decode(result.value));
}
