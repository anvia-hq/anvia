import type {
  CompletionModel,
  CompletionRequest,
  CompletionTool,
  Document,
  JsonObject,
  JsonValue,
  Message,
  ProviderTool,
  ToolChoice,
  ToolDefinition,
} from "../completion/types";
import { isProviderTool } from "../completion/types";

type ModelNameOf<M extends CompletionModel> =
  M extends CompletionModel<unknown, infer ModelName> ? ModelName : string;

export class CompletionRequestBuilder<M extends CompletionModel = CompletionModel> {
  private requestModel: ModelNameOf<M> | undefined;
  private instructionBlocks: string[] = [];
  private history: Message[] = [];
  private docs: Document[] = [];
  private toolDefs: ToolDefinition[] = [];
  private providerToolDefs: ProviderTool[] = [];
  private temp: number | undefined;
  private maxTokenCount: number | undefined;
  private choice: ToolChoice | undefined;
  private params: JsonValue | undefined;
  private schema: JsonObject | undefined;

  constructor(
    _model: M,
    private readonly promptMessage: Message,
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

  messages(messages: Message[]): this {
    this.history.push(...messages);
    return this;
  }

  documents(documents: Document[]): this {
    this.docs.push(...documents);
    return this;
  }

  tools(tools: CompletionTool[]): this {
    for (const tool of tools) {
      if (isProviderTool(tool)) this.providerToolDefs.push(tool);
      else this.toolDefs.push(tool);
    }
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
    const instructions =
      this.instructionBlocks.length === 0 ? undefined : this.instructionBlocks.join("\n\n");
    const request: CompletionRequest<ModelNameOf<M>> = {
      chatHistory: [...this.history, this.promptMessage],
      documents: [...this.docs],
      tools: [...this.toolDefs],
    };

    if (this.providerToolDefs.length > 0) request.providerTools = [...this.providerToolDefs];
    if (this.requestModel !== undefined) request.model = this.requestModel;
    if (instructions !== undefined) request.instructions = instructions;
    if (this.temp !== undefined) request.temperature = this.temp;
    if (this.maxTokenCount !== undefined) request.maxTokens = this.maxTokenCount;
    if (this.choice !== undefined) request.toolChoice = this.choice;
    if (this.params !== undefined) request.additionalParams = this.params;
    if (this.schema !== undefined) request.outputSchema = this.schema;

    return request;
  }
}
