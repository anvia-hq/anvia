import type {
  CompletionModelCapabilities,
  CompletionRequest,
  CompletionResponse,
  CompletionStreamEvent,
  JsonObject,
  StreamingCompletionModel,
} from "@anvia/core/completion";
import { OpenAIChatCompletionModel, OpenAIResponsesCompletionModel } from "@anvia/openai";
import type { OpenAI } from "openai";
import { GROK_4_5 } from "./constants";
import type { GrokCompletionModelName } from "./models";

export class GrokResponsesCompletionModel
  implements StreamingCompletionModel<unknown, GrokCompletionModelName>
{
  readonly provider = "grok";
  readonly capabilities: CompletionModelCapabilities;
  private readonly delegate: OpenAIResponsesCompletionModel;

  constructor(
    client: OpenAI,
    readonly defaultModel: GrokCompletionModelName = GROK_4_5,
  ) {
    this.delegate = new OpenAIResponsesCompletionModel(client, defaultModel);
    this.capabilities = { ...this.delegate.capabilities, providerTools: true };
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
    return await this.delegate.completion(request);
  }

  streamCompletion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): AsyncIterable<CompletionStreamEvent> {
    assertGrokProviderTools(request);
    return this.delegate.streamCompletion(request);
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
  ) {
    this.delegate = new OpenAIChatCompletionModel(client, defaultModel);
    this.capabilities = this.delegate.capabilities;
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
    return await this.delegate.completion(request);
  }

  streamCompletion(
    request: CompletionRequest<GrokCompletionModelName>,
  ): AsyncIterable<CompletionStreamEvent> {
    assertGrokProviderTools(request);
    return this.delegate.streamCompletion(request);
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
