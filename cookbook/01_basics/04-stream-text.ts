import { Agent } from "@anvia/core/agent";
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

// Streaming yields normalized events; text_delta contains the visible answer text.
for await (const event of agent.stream({
  prompt: "Write a short haiku about TypeScript agents.",
})) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "response") {
    process.stdout.write("\n");
    console.log(event.usage);
  }
}
