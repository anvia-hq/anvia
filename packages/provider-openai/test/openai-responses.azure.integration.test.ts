import type { CompletionModelStreamEvent } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { OpenAIClient } from "../src/index";

const azureApiKey = process.env.OPENAI_API_KEY;
const azureIntegrationEnabled = process.env.ANVIA_AZURE_OPENAI_TESTS === "1";
const azureBaseUrl =
  "https://alphax-8885-resource.services.ai.azure.com/api/projects/alphax-8885/openai/v1";

describe.skipIf(!azureIntegrationEnabled || !azureApiKey)(
  "Azure AI Foundry Responses streaming",
  () => {
    it("streams a required function call whose arguments.done event omits the function name", async () => {
      const client = new OpenAIClient({
        apiKey: azureApiKey!,
        baseUrl: azureBaseUrl,
      });
      const model = client.completionModel({
        modelId: "gpt-5.6-luna",
        api: "responses",
      });
      const events: CompletionModelStreamEvent[] = [];

      for await (const event of model.streamCompletion({
        chatHistory: [Message.user("Call get_weather for Jakarta. Do not answer directly.")],
        documents: [],
        tools: [
          {
            name: "get_weather",
            description: "Get the weather for a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
          },
        ],
        toolChoice: "required",
        controls: { reasoningEffort: "low" },
      })) {
        events.push(event);
      }

      const finalEvent = events.find(
        (event): event is Extract<CompletionModelStreamEvent, { type: "final" }> =>
          event.type === "final",
      );
      expect(finalEvent).toBeDefined();
      expect(finalEvent?.response.choice.filter((part) => part.type === "tool-call")).toEqual([
        expect.objectContaining({
          type: "tool-call",
          toolName: "get_weather",
          input: { city: "Jakarta" },
        }),
      ]);
    }, 120_000);
  },
);
