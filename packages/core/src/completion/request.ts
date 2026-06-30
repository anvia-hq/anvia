import type {
  CompletionModel,
  CompletionRequest,
  CompletionResponse,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ToolChoice,
  ToolDefinition,
} from "./types";
import { assertCompletionRequestSupported } from "./types";

type ModelNameOf<M extends CompletionModel> =
  M extends CompletionModel<unknown, infer ModelName> ? ModelName : string;

type RawResponseOf<M extends CompletionModel> =
  M extends CompletionModel<infer RawResponse, infer _ModelName> ? RawResponse : unknown;

export class CompletionRequestBuilder<M extends CompletionModel = CompletionModel> {
  private requestModel: ModelNameOf<M> | undefined;
  private instructionBlocks: string[] = [];
  private history: MessageType[] = [];
  private docs: Document[] = [];
  private toolDefs: ToolDefinition[] = [];
  private temp: number | undefined;
  private maxTokenCount: number | undefined;
  private choice: ToolChoice | undefined;
  private params: JsonValue | undefined;
  private schema: JsonObject | undefined;

  constructor(
    private readonly model: M,
    private readonly promptMessage: MessageType,
  ) {}

  modelOverride(model: ModelNameOf<M> | undefined): this {
    this.requestModel = model;
    return this;
  }

  instructions(instructions: string | undefined): this {
    if (instructions !== undefined && instructions.length > 0) {
      this.instructionBlocks.push(instructions);
    }
    return this;
  }

  messages(messages: MessageType[]): this {
    this.history.push(...messages);
    return this;
  }

  documents(documents: Document[]): this {
    this.docs.push(...documents);
    return this;
  }

  tools(tools: ToolDefinition[]): this {
    this.toolDefs.push(...tools);
    return this;
  }

  temperature(temperature: number | undefined): this {
    this.temp = temperature;
    return this;
  }

  maxTokens(maxTokens: number | undefined): this {
    this.maxTokenCount = maxTokens;
    return this;
  }

  toolChoice(toolChoice: ToolChoice | undefined): this {
    this.choice = toolChoice;
    return this;
  }

  additionalParams(additionalParams: JsonValue | undefined): this {
    this.params = additionalParams;
    return this;
  }

  outputSchema(outputSchema: JsonObject | undefined): this {
    this.schema = outputSchema;
    return this;
  }

  build(): CompletionRequest<ModelNameOf<M>> {
    const instructions = this.buildInstructions();
    const request: CompletionRequest<ModelNameOf<M>> = {
      chatHistory: [...this.history, this.promptMessage],
      documents: [...this.docs],
      tools: [...this.toolDefs],
    };

    if (this.requestModel !== undefined) request.model = this.requestModel;
    if (instructions !== undefined) request.instructions = instructions;
    if (this.temp !== undefined) request.temperature = this.temp;
    if (this.maxTokenCount !== undefined) request.maxTokens = this.maxTokenCount;
    if (this.choice !== undefined) request.toolChoice = this.choice;
    if (this.params !== undefined) request.additionalParams = this.params;
    if (this.schema !== undefined) request.outputSchema = this.schema;

    return request;
  }

  async send(): Promise<CompletionResponse<RawResponseOf<M>>> {
    const request = this.build();
    assertCompletionRequestSupported(this.model, request);
    return this.model.completion(request) as Promise<CompletionResponse<RawResponseOf<M>>>;
  }

  private buildInstructions(): string | undefined {
    return this.instructionBlocks.length === 0 ? undefined : this.instructionBlocks.join("\n\n");
  }
}
