import type {
  CompletionModelCapabilities,
  CompletionModelInfo,
  CompletionModelMetadataOptions,
  CompletionRequest,
  CompletionResponse,
  CompletionStreamEvent,
  JsonObject,
  StreamingCompletionModel,
} from "@anvia/core/completion";
import { resolveCompletionModelInfo, withContextUsage } from "@anvia/core/completion";
import { OpenAIChatCompletionModel, OpenAIResponsesCompletionModel } from "@anvia/openai";
import type { OpenAI } from "openai";
import { GROK_4_5 } from "./constants";
import { GROK_COMPLETION_MODEL_CONTEXT_LIMITS, type GrokCompletionModelName } from "./models";

export class GrokResponsesCompletionModel
  implements StreamingCompletionModel<unknown, GrokCompletionModelName>
{
  readonly provider = "grok";
  readonly capabilities: CompletionModelCapabilities;
  private readonly delegate: OpenAIResponsesCompletionModel;

  constructor(
    client: OpenAI,
    readonly defaultModel: GrokCompletionModelName = GROK_4_5,
    private readonly metadataOptions: CompletionModelMetadataOptions = {},
  ) {
    this.delegate = new OpenAIResponsesCompletionModel(client, defaultModel);
    this.capabilities = { ...this.delegate.capabilities, providerTools: true };
  }

  getModelInfo(
    model: GrokCompletionModelName = this.defaultModel,
  ): CompletionModelInfo<GrokCompletionModelName> | undefined {
    return resolveCompletionModelInfo(
      model,
      GROK_COMPLETION_MODEL_CONTEXT_LIMITS,
      this.metadataOptions.modelOverrides,
    );
  }

  traceRequest(
    request: CompletionRequest<GrokCompletionModelName>,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    return {
      ...this.delegate.traceRequest(request, options),
      provider: this.provider,
    };
  }

  async completion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): Promise<CompletionResponse> {
    assertGrokProviderTools(request);
    return withContextUsage(
      await this.delegate.completion(request),
      this.getModelInfo(request.model ?? this.defaultModel),
    );
  }

  async *streamCompletion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): AsyncIterable<CompletionStreamEvent> {
    assertGrokProviderTools(request);
    for await (const event of this.delegate.streamCompletion(request)) {
      yield event.type === "final"
        ? {
            ...event,
            response: withContextUsage(
              event.response,
              this.getModelInfo(request.model ?? this.defaultModel),
            ),
          }
        : event;
    }
  }
}

export class GrokChatCompletionModel
  implements StreamingCompletionModel<unknown, GrokCompletionModelName>
{
  readonly provider = "grok-chat";
  readonly capabilities: CompletionModelCapabilities;
  private readonly delegate: OpenAIChatCompletionModel;

  constructor(
    client: OpenAI,
    readonly defaultModel: GrokCompletionModelName = GROK_4_5,
    private readonly metadataOptions: CompletionModelMetadataOptions = {},
  ) {
    this.delegate = new OpenAIChatCompletionModel(client, defaultModel);
    this.capabilities = this.delegate.capabilities;
  }

  getModelInfo(
    model: GrokCompletionModelName = this.defaultModel,
  ): CompletionModelInfo<GrokCompletionModelName> | undefined {
    return resolveCompletionModelInfo(
      model,
      GROK_COMPLETION_MODEL_CONTEXT_LIMITS,
      this.metadataOptions.modelOverrides,
    );
  }

  traceRequest(
    request: CompletionRequest<GrokCompletionModelName>,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject {
    return {
      ...this.delegate.traceRequest(request, options),
      provider: this.provider,
    };
  }

  async completion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): Promise<CompletionResponse> {
    assertGrokProviderTools(request);
    return withContextUsage(
      await this.delegate.completion(request),
      this.getModelInfo(request.model ?? this.defaultModel),
    );
  }

  async *streamCompletion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): AsyncIterable<CompletionStreamEvent> {
    assertGrokProviderTools(request);
    for await (const event of this.delegate.streamCompletion(request)) {
      yield event.type === "final"
        ? {
            ...event,
            response: withContextUsage(
              event.response,
              this.getModelInfo(request.model ?? this.defaultModel),
            ),
          }
        : event;
    }
  }
}

function assertGrokProviderTools(request: CompletionRequest<GrokCompletionModelName>): void {
  const mismatched = request.providerTools?.find((tool) => tool.provider !== "grok");
  if (mismatched !== undefined) {
    throw new TypeError(
      `Grok completion cannot use provider tool "${mismatched.name}" from "${mismatched.provider}".`,
    );
  }
}
