import { describe, expect, it, vi } from "vitest";
import * as v from "valibot";

vi.mock("@valibot/to-json-schema", () => {
  throw new Error("Cannot find module '@valibot/to-json-schema'");
});

import {
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  generateCompletion,
} from "./helpers/imports";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "missing-converter";
  readonly capabilities: CompletionModelCapabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    return {
      choice: [AssistantContent.text('{"title":"Typed"}')],
      usage: {
        inputTokens: 0,
        outputTokens: 1,
        totalTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rawResponse: {},
    };
  }
}

describe("Standard Schema output without the Valibot converter installed", () => {
  it("explains that @valibot/to-json-schema must be installed", async () => {
    const model = new QueueModel();

    await expect(
      generateCompletion({
        model,
        prompt: "extract",
        outputSchema: v.object({ title: v.string() }),
      }),
    ).rejects.toThrow(
      'The structured output schema is a Valibot schema, but "@valibot/to-json-schema" is not installed.',
    );
    expect(model.requests).toHaveLength(0);
  });
});
