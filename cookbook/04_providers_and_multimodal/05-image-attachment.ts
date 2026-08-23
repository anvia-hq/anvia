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
  instructions: "Answer visual questions briefly.",
});

// Multimodal prompts combine text with image content parts.
const response = await agent.generate({
  prompt: {
    role: "user",
    content: [
      { type: "text", text: "What is shown in this image?" },
      {
        type: "image",
        image: {
          type: "url",
          url: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg",
        },
        detail: "auto",
      },
    ],
  },
});

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
