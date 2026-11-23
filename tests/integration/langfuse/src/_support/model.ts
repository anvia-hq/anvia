import {
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { optionalEnv, requireEnv } from "./env.js";

export function buildOpenAIClient(): OpenAIClient {
  return new OpenAIClient({
    apiKey: requireEnv("OPENAI_API_KEY"),
    baseUrl: optionalEnv("OPENAI_BASEURL"),
  });
}

export function defaultModelId(): string {
  return optionalEnv("ANVIA_MODEL") ?? "gpt-5";
}

export function getStaticModel(text: string): CompletionModel {
  return {
    provider: "langfuse-ops-static",
    modelId: "static",
    capabilities: {
      streaming: false,
      tools: false,
      toolChoice: false,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    async completion(_request: CompletionRequest): Promise<CompletionResponse> {
      return {
        choice: [{ type: "text", text }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  };
}
