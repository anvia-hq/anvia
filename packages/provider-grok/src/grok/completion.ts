import type {
  CompletionModelControls,
  CompletionModelCapabilities,
  CompletionModelStreamEvent,
  CompletionRequest,
  CompletionResponse,
  JsonObject,
  ModelCallOptions,
  ModelContextLimits,
  StreamingCompletionModel,
} from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";
import type { OpenAI } from "openai";
import type { GrokCompletionModelId } from "./models";

export class GrokCompletionModel<
  Controls extends CompletionModelControls = CompletionModelControls,
> implements StreamingCompletionModel<unknown, Controls> {
  readonly provider = "grok";
  readonly capabilities: CompletionModelCapabilities;
  private readonly delegate: StreamingCompletionModel<unknown, Controls>;

  constructor(
    client: OpenAI,
    readonly modelId: GrokCompletionModelId,
    api: "responses" | "chat",
    readonly contextLimits?: ModelContextLimits,
    readonly controls?: Controls,
  ) {
    this.delegate = new OpenAIClient({ client }).completionModel({
      modelId,
      api,
      contextLimits,
      controls,
    });
    this.capabilities = { ...this.delegate.capabilities };
    if (api === "responses") this.capabilities = { ...this.capabilities, providerTools: true };
  }

  traceRequest(
    request: CompletionRequest,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    return {
      ...this.delegate.traceRequest?.(request, options),
      provider: this.provider,
    };
  }

  async completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    assertGrokProviderTools(request);
    return this.delegate.completion(request, options);
  }

  async *streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    assertGrokProviderTools(request);
    yield* this.delegate.streamCompletion(request, options);
  }
}

function assertGrokProviderTools(request: CompletionRequest): void {
  const mismatched = request.providerTools?.find((tool) => tool.provider !== "grok");
  if (mismatched !== undefined) {
    throw new TypeError(
      `Grok completion cannot use provider tool "${mismatched.name}" from "${mismatched.provider}".`,
    );
  }
}
