import { describe, expectTypeOf, it } from "vitest";
import { createCompletionRequest } from "../src/internal/completion-request";
import type { ModelId } from "../src/model-listing";
import {
  type CompletionModel,
  type CompletionRequest,
  Message,
  type Usage,
} from "./helpers/imports";

type TestModelName = ModelId<"known-model">;

class TypedModel implements CompletionModel<unknown, TestModelName> {
  readonly provider = "test";
  readonly defaultModel: TestModelName = "known-model";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };

  async completion(request: CompletionRequest<TestModelName>) {
    return {
      choice: [],
      usage: {} as Usage,
      rawResponse: request,
    };
  }
}

describe("completion model types", () => {
  it("infers known model names for request overrides while accepting custom strings", () => {
    const request = createCompletionRequest(Message.user("hello"), {
      model: new TypedModel(),
      modelOverride: "custom-model",
    });

    expectTypeOf(request.model).toEqualTypeOf<TestModelName | undefined>();
  });
});
