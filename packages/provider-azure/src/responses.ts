import type {
  CompletionModelControls,
  CompletionRequest,
  JsonObject,
} from "@anvia/core/completion";
import { OpenAIResponsesCompletionModel } from "@anvia/openai/adapters";
import { normalizeAzureResponsesStream } from "./responses-stream";

export class AzureOpenAIResponsesCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> extends OpenAIResponsesCompletionModel<Controls> {
  override readonly provider = "azure-openai";

  protected override normalizeStream(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
    return normalizeAzureResponsesStream(stream);
  }

  protected override requestParams(request: CompletionRequest): Record<string, unknown> {
    const params = super.requestParams(request);
    if (Array.isArray(params.input)) {
      // Foundry project endpoints require explicit message types. This is also valid on resource endpoints.
      params.input = params.input.map((item) =>
        typeof item === "object" && item !== null && "role" in item && !("type" in item)
          ? { ...item, type: "message" }
          : item,
      );
    }
    return params;
  }

  override traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    return { ...super.traceRequest(request, options), provider: "azure-openai-responses" };
  }
}
