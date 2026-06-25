import {
  AssistantContent,
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

export function defaultModel(): string {
  return optionalEnv("ANVIA_MODEL") ?? "gpt-5";
}

// Deterministic model that always returns the same text. Used by demos
// where a real LLM call would add noise and cost.
export function getStaticModel(text: string): CompletionModel {
  return {
    provider: "langfuse-ops-static",
    defaultModel: "static",
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
        choice: [AssistantContent.text(text)],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  };
}
