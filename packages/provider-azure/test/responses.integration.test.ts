import type { CompletionModelStreamEvent } from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { AzureOpenAIClient } from "../src/index";

const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureIntegrationEnabled = process.env.ANVIA_AZURE_OPENAI_TESTS === "1";
const azureBaseUrl = process.env.AZURE_OPENAI_BASE_URL;
const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;

if (azureIntegrationEnabled) {
  const missing = Object.entries({
    AZURE_OPENAI_API_KEY: azureApiKey,
    AZURE_OPENAI_BASE_URL: azureBaseUrl,
    AZURE_OPENAI_DEPLOYMENT: azureDeployment,
  })
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `Azure live tests require ${missing.join(", ")}. Fill the root .env before running test:live.`,
    );
  }
}

describe.skipIf(!azureIntegrationEnabled)("Azure AI Foundry Responses streaming", () => {
  it("streams a required function call with complete arguments", async () => {
    const client = new AzureOpenAIClient({
      apiKey: azureApiKey!,
      baseUrl: azureBaseUrl!,
    });
    const model = client.completionModel({
      modelId: azureDeployment!,
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
});
