import { describe, expectTypeOf, it } from "vitest";
import { createCompletionRequest } from "../src/internal/completion-request";
import {
  type CompletionModel,
  type CompletionRequest,
  Message,
  type Usage,
} from "./helpers/imports";

class TypedModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "known-model" as const;
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };

  async completion(request: CompletionRequest) {
    return {
      choice: [],
      usage: {} as Usage,
      rawResponse: request,
    };
  }
}

describe("completion model types", () => {
  it("binds identity to the model and omits request-level model selection", () => {
    const model = new TypedModel();
    const request = createCompletionRequest(Message.user("hello"), {});

    expectTypeOf(model.modelId).toEqualTypeOf<"known-model">();
    expectTypeOf(request).not.toHaveProperty("model");

    createCompletionRequest(Message.user("hello"), {
      // @ts-expect-error modelOverride was removed; construct another model handle instead.
      modelOverride: "custom-model",
    });
  });
});
