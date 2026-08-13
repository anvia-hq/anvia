import { type Agent, getAgentToolState } from "../agent/agent";
import { AgentBuilder } from "../agent/builder";
import type { ContextIndex } from "../agent/context-index";
import {
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionResponse,
  createCompletion,
  type Document,
  type JsonValue,
  type Message,
  Message as MessageFactory,
  type ToolChoice,
  Usage,
} from "../completion/index";
import { fetchContextDocuments } from "../internal/agent-runtime/retrieval";
import { extractRagText } from "../internal/rag-text";
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
        const toolState = getAgentToolState(this.agent);
        const ragText = extractRagText(prompt);
        const documents = await fetchContextDocuments(this.agent, ragText);
        const toolDefs = await Promise.all(
          toolState.staticTools.map((tool) => tool.definition(ragText ?? "")),
        );
        const result = await createCompletion([...(history ?? []), prompt], {
          model: this.agent.model,
          instructions: this.agent.instructions,
          documents,
          tools: [...toolDefs, ...toolState.providerTools],
          temperature: this.agent.temperature,
          maxTokens: this.agent.maxTokens,
          additionalParams: this.agent.additionalParams,
          toolChoice: this.agent.toolChoice,
        });
        const response = result.response;
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
      .tools([
        createTool({
          name: SUBMIT_TOOL_NAME,
          description: "Submit the structured data extracted from the provided text.",
          inputSchema: schema,
          outputSchema: schema,
          execute: (args) => args,
        }),
      ])
      .toolChoice("required");
  }

  instructions(instructions: string): this {
    this.agentBuilder.instructions(instructions);
    return this;
  }

  context(text: string, id?: string): this;
  context(input: Document | ContextIndex): this;
  context(input: string | Document | ContextIndex, id?: string): this {
    if (typeof input === "string") {
      this.agentBuilder.context(input, id);
    } else {
      this.agentBuilder.context(input);
    }
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
