import { AnthropicClient } from "@anvia/anthropic";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openai = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const anthropic = new AnthropicClient({
  baseUrl: process.env.ANTHROPIC_BASEURL,
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

const agent = new Agent({
  id: "studio-model-router",
  model: openai.completionModel({ modelId: "gpt-5.6-luna", api: "responses" }),
  name: "Studio Model Router",
  description: "Demonstrates Studio model selection across multiple providers.",
  instructions: [
    "You are a helpful general-purpose assistant used to compare provider behavior in Anvia Studio.",
    "Answer clearly and concisely. Adapt your tone and depth to the user's request.",
  ].join("\n"),
});

new Studio([agent], {
  models: {
    defaultModelRef: { providerId: "openai", modelId: "gpt-5.6-luna" },
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "gpt-5.6-luna",
        createCompletionModel: ({ modelId }) =>
          openai.completionModel({ modelId, api: "responses" }),
        listModels: () => openai.listModels(),
        models: [
          {
            id: "gpt-5.6-luna",
            name: "GPT-5.6 Luna",
            modalities: {
              input: ["text", "image", "document"],
              output: ["text"],
            },
            capabilities: {
              streaming: true,
              tools: true,
              imageInput: true,
              documentInput: true,
              outputSchema: true,
              reasoning: true,
            },
          },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        defaultModelId: "claude-opus-4-8",
        createCompletionModel: ({ modelId }) => anthropic.completionModel({ modelId }),
        listModels: () => anthropic.listModels(),
        models: [
          {
            id: "claude-opus-4-8",
            name: "Claude Sonnet 4",
            modalities: {
              input: ["text", "image", "document"],
              output: ["text"],
            },
            capabilities: {
              streaming: true,
              tools: true,
              imageInput: true,
              documentInput: true,
              reasoning: true,
            },
          },
        ],
      },
    ],
    agents: {
      "studio-model-router": {
        defaultModelRef: { providerId: "openai", modelId: "gpt-5.6-luna" },
        allowed: [
          { providerId: "openai", modelId: "gpt-5.6-luna" },
          { providerId: "anthropic", modelId: "claude-opus-4-8" },
        ],
      },
    },
  },
  quickPrompts: {
    "studio-model-router": [
      "Explain the difference between latency, quality, and cost when choosing a model.",
      "Draft a short project update for a weekly team check-in.",
      "What should I consider before routing multimodal work to a model?",
    ],
  },
}).start({ port: 4021 });

console.log("Open http://localhost:4021/ui/playground");
console.log("Use the model selector in the message composer to switch providers per run.");
console.log("Open http://localhost:4021/agents/studio-model-router/models for the model catalog.");
