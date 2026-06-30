import { describe, expectTypeOf, it } from "vitest";
import type { ModelId } from "../src/model-listing";
import {
  type CompletionModel,
  type CompletionRequest,
  CompletionRequestBuilder,
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
  it("infers known model names for request builder overrides while accepting custom strings", () => {
    const request = new CompletionRequestBuilder(new TypedModel(), Message.user("hello"))
      .modelOverride("known-model")
      .modelOverride("custom-model")
      .build();

    expectTypeOf(request.model).toEqualTypeOf<TestModelName | undefined>();
  });
});
