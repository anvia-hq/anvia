import { z } from "zod";
import {
  type AssistantContent,
  CompletionCapabilityError,
  type CompletionModel,
  generateCompletion,
  type JsonObject,
  type Message,
  Message as MessageFactory,
  type ToolDefinition,
  Usage,
} from "../completion/index";
import {
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  retryDelayMs,
  retryOptionsForFailure,
  waitForRetry,
} from "../retry";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";

const SUBMIT_TOOL_NAME = "submit";

const DEFAULT_EXTRACTOR_INSTRUCTIONS =
  "You are an AI assistant whose purpose is to extract structured data from the provided text.\n" +
  "You have access to a `submit` function that defines the structure of the data to extract.\n" +
  "Always call the `submit` function with the structured data. Use default or null values when information is missing.";

export type ExtractorOptions<T, M extends CompletionModel = CompletionModel> = {
  model: M;
  outputSchema: ZodSchema<T>;
  instructions?: string | undefined;
};

export type ExtractOptions = {
  retries?: RetrySetting | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type ExtractionResult<T> = {
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

/** Converts text into data validated and transformed by a Zod output schema. */
export class Extractor<T, M extends CompletionModel = CompletionModel> {
  readonly model: M;
  readonly outputSchema: ZodSchema<T>;

  private readonly instructions: string;
  private readonly submitTool: ToolDefinition;

  constructor(options: ExtractorOptions<T, M>) {
    if (!(options.outputSchema instanceof z.ZodType)) {
      throw new TypeError("Extractor outputSchema must be a Zod schema.");
    }

    this.model = options.model;
    this.outputSchema = options.outputSchema;
    this.instructions =
      options.instructions === undefined || options.instructions.length === 0
        ? DEFAULT_EXTRACTOR_INSTRUCTIONS
        : `${DEFAULT_EXTRACTOR_INSTRUCTIONS}\n\n${options.instructions}`;
    this.submitTool = {
      name: SUBMIT_TOOL_NAME,
      description: "Submit the structured data extracted from the provided text.",
      parameters: toProviderJsonSchema(this.outputSchema, { io: "input" }),
    };
  }

  async extract(text: string, options: ExtractOptions = {}): Promise<T> {
    return (await this.extractResult(text, options)).data;
  }

  async extractResult(text: string, options: ExtractOptions = {}): Promise<ExtractionResult<T>> {
    const prompt = MessageFactory.user(text);
    const retries = resolveExtractionRetries(options.retries);
    const maxAttempts = retries?.maxAttempts ?? 1;
    let usage = Usage.empty();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await generateCompletion({
          model: this.model,
          messages: [prompt],
          instructions: this.instructions,
          tools: [globalThis.structuredClone(this.submitTool)],
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          providerOptions: options.providerOptions,
          toolChoice: "required",
          retries: false,
          abortSignal: options.abortSignal,
        });
        usage = Usage.add(usage, result.usage);
        const data = extractSubmittedData(result.content, this.outputSchema);
        return {
          data,
          usage,
          messages: [
            prompt,
            MessageFactory.assistant([...result.content], {
              ...(result.messageId === undefined ? {} : { id: result.messageId }),
            }),
          ],
        };
      } catch (error) {
        if (error instanceof CompletionCapabilityError) {
          throw error;
        }
        lastError = error;
        const retryOptions = retryOptionsForFailure(retries, {
          error,
          attempt,
          streaming: false,
        });
        if (retryOptions === undefined) {
          break;
        }
        await waitForRetry(retryDelayMs(retryOptions, attempt), options.abortSignal);
      }
    }

    throw new ExtractionError("No data extracted", lastError);
  }
}

function resolveExtractionRetries(
  options: RetrySetting | undefined,
): ResolvedRetryOptions | undefined {
  if (options === undefined || options === false) {
    return undefined;
  }
  return resolveRetryOptions({
    ...options,
    shouldRetry: options.shouldRetry ?? (() => true),
  });
}

function extractSubmittedData<T>(content: readonly AssistantContent[], schema: ZodSchema<T>): T {
  const submitted = content
    .filter((content) => content.type === "tool_call")
    .filter((toolCall) => toolCall.function.name === SUBMIT_TOOL_NAME)
    .at(-1);

  if (submitted === undefined) {
    throw new ExtractionError("The model did not call the submit tool");
  }

  try {
    return schema.parse(submitted.function.arguments);
  } catch (error) {
    throw new ExtractionError("Submitted data failed output schema validation", error);
  }
}
