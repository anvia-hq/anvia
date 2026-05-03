import { type Agent, AgentBuilder } from "../agent/index";
import {
  CompletionCapabilityError,
  type CompletionModel,
  CompletionRequestBuilder,
  type CompletionResponse,
  type JsonValue,
  type Message,
  Message as MessageFactory,
  type ToolChoice,
  Usage,
} from "../completion/index";
import type { ZodSchema } from "../schema/zod-schema";
import { createTool } from "../tool/index";

const SUBMIT_TOOL_NAME = "submit";

const DEFAULT_EXTRACTOR_INSTRUCTIONS =
  "You are an AI assistant whose purpose is to extract structured data from the provided text.\n" +
  "You have access to a `submit` function that defines the structure of the data to extract.\n" +
  "Always call the `submit` function with the structured data. Use default or null values when information is missing.";

export type ExtractionResponse<T> = {
  data: T;
  usage: Usage;
  messages: Message[];
};

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export class Extractor<T, M extends CompletionModel = CompletionModel> {
  constructor(
    private readonly agent: Agent<M>,
    private readonly schema: ZodSchema<T>,
    private readonly retryCount: number,
  ) {}

  async extract(text: string | Message): Promise<T> {
    return (await this.extractWithUsage(text)).data;
  }

  async extractWithUsage(text: string | Message): Promise<ExtractionResponse<T>> {
    return this.run(text);
  }

  async extractWithHistory(text: string | Message, history: Message[]): Promise<T> {
    return (await this.run(text, history)).data;
  }

  getInner(): Agent<M> {
    return this.agent;
  }

  private async run(text: string | Message, history?: Message[]): Promise<ExtractionResponse<T>> {
    let usage = Usage.empty();
    let lastError: unknown;
    const prompt = typeof text === "string" ? MessageFactory.user(text) : text;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        const toolDefs = await this.agent.toolSet.getToolDefinitions(extractRagText(prompt));
        const response = await new CompletionRequestBuilder(this.agent.model, prompt)
          .instructions(this.agent.instructions)
          .messages(history ?? [])
          .documents(this.agent.staticContext)
          .tools(toolDefs)
          .temperature(this.agent.temperature)
          .maxTokens(this.agent.maxTokens)
          .additionalParams(this.agent.additionalParams)
          .toolChoice(this.agent.toolChoice)
          .send();
        usage = Usage.add(usage, response.usage);
        const data = extractSubmittedData(response, this.schema);
        return {
          data,
          usage,
          messages: [
            ...(history ?? []),
            prompt,
            MessageFactory.assistant(response.choice, response.messageId),
          ],
        };
      } catch (error) {
        if (error instanceof CompletionCapabilityError) {
          throw error;
        }
        lastError = error;
      }
    }

    throw new ExtractionError("No data extracted", lastError);
  }
}

export class ExtractorBuilder<T, M extends CompletionModel = CompletionModel> {
  private readonly agentBuilder: AgentBuilder<M>;
  private retryCount = 0;

  constructor(
    model: M,
    private readonly schema: ZodSchema<T>,
  ) {
    this.agentBuilder = new AgentBuilder("extractor", model)
      .instructions(DEFAULT_EXTRACTOR_INSTRUCTIONS)
      .tool(
        createTool({
          name: SUBMIT_TOOL_NAME,
          description: "Submit the structured data extracted from the provided text.",
          input: schema,
          output: schema,
          execute: (args) => args,
        }),
      )
      .toolChoice("required");
  }

  instructions(instructions: string): this {
    this.agentBuilder.instructions(instructions);
    return this;
  }

  context(text: string, id?: string): this {
    this.agentBuilder.context(text, id);
    return this;
  }

  temperature(temperature: number): this {
    this.agentBuilder.temperature(temperature);
    return this;
  }

  maxTokens(maxTokens: number): this {
    this.agentBuilder.maxTokens(maxTokens);
    return this;
  }

  additionalParams(params: JsonValue): this {
    this.agentBuilder.additionalParams(params);
    return this;
  }

  toolChoice(toolChoice: ToolChoice): this {
    this.agentBuilder.toolChoice(toolChoice);
    return this;
  }

  retries(retries: number): this {
    this.retryCount = Math.max(0, Math.trunc(retries));
    return this;
  }

  build(): Extractor<T, M> {
    return new Extractor(this.agentBuilder.build(), this.schema, this.retryCount);
  }
}

function extractSubmittedData<T>(response: CompletionResponse, schema: ZodSchema<T>): T {
  const submitted = response.choice
    .filter((content) => content.type === "tool_call")
    .filter((toolCall) => toolCall.function.name === SUBMIT_TOOL_NAME)
    .at(-1);

  if (submitted === undefined) {
    throw new ExtractionError("The model did not call the submit tool");
  }

  return schema.parse(submitted.function.arguments);
}

function extractRagText(message: Message): string | undefined {
  if (message.role === "user") {
    return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  }

  return undefined;
}
