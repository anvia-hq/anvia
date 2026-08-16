import { z } from "zod";
import {
  type AssistantContentPart,
  CompletionCapabilityError,
  type CompletionModel,
  type CompletionResult,
  generateCompletion,
  type JsonObject,
  type ToolDefinition,
  Usage,
} from "../completion/index";
import { isAbortError } from "../internal/abort";
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

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export type ExtractOptions<Output, Model extends CompletionModel = CompletionModel> = {
  model: Model;
  text: string;
  outputSchema: ZodSchema<Output>;
  instructions?: string | undefined;
  retries?: RetrySetting | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  providerOptions?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type ExtractionResult<Output, RawResponse = unknown> = Omit<
  CompletionResult<string, RawResponse>,
  "output"
> & {
  output: Output;
};

export class ExtractionError extends Error {
  readonly attempts: number;
  readonly usage: Usage;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      attempts: number;
      usage: Usage;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExtractionError";
    this.attempts = options.attempts;
    this.usage = options.usage;
  }
}

/** Extract structured data from text using a required, schema-backed submit tool. */
export async function extract<Output, Model extends CompletionModel>(
  options: ExtractOptions<Output, Model>,
): Promise<ExtractionResult<Output, RawResponseOf<Model>>> {
  if (!(options.outputSchema instanceof z.ZodType)) {
    throw new TypeError("extract outputSchema must be a Zod schema.");
  }
  if (typeof options.text !== "string") {
    throw new TypeError("extract text must be a string.");
  }

  const retries = resolveExtractionRetries(options.retries);
  const maxAttempts = retries?.maxAttempts ?? 1;
  const submitTool = createSubmitTool(options.outputSchema);
  const instructions = extractionInstructions(options.instructions);
  let usage = Usage.empty();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await generateCompletion({
        model: options.model,
        prompt: options.text,
        instructions,
        tools: [globalThis.structuredClone(submitTool)],
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        providerOptions: options.providerOptions,
        toolChoice: "required",
        retries: false,
        abortSignal: options.abortSignal,
      });
      usage = Usage.add(usage, result.usage);
      return {
        ...result,
        output: extractSubmittedData(result.content, options.outputSchema),
        usage,
      };
    } catch (error) {
      if (error instanceof CompletionCapabilityError || isAbortError(error)) {
        throw error;
      }
      lastError = error;
      const retryOptions = retryOptionsForFailure(retries, {
        error,
        attempt,
        streaming: false,
      });
      if (retryOptions === undefined) {
        throw new ExtractionError("No data extracted", {
          cause: lastError,
          attempts: attempt,
          usage,
        });
      }
      await waitForRetry(retryDelayMs(retryOptions, attempt), options.abortSignal);
    }
  }

  throw new ExtractionError("No data extracted", {
    cause: lastError,
    attempts: maxAttempts,
    usage,
  });
}

function extractionInstructions(instructions: string | undefined): string {
  return instructions === undefined || instructions.length === 0
    ? DEFAULT_EXTRACTOR_INSTRUCTIONS
    : `${DEFAULT_EXTRACTOR_INSTRUCTIONS}\n\n${instructions}`;
}

function createSubmitTool<Output>(outputSchema: ZodSchema<Output>): ToolDefinition {
  return {
    name: SUBMIT_TOOL_NAME,
    description: "Submit the structured data extracted from the provided text.",
    parameters: toProviderJsonSchema(outputSchema, { io: "input" }),
  };
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

function extractSubmittedData<Output>(
  content: readonly AssistantContentPart[],
  schema: ZodSchema<Output>,
): Output {
  const submitted = content
    .filter((item) => item.type === "tool-call")
    .filter((toolCall) => toolCall.toolName === SUBMIT_TOOL_NAME)
    .at(-1);

  if (submitted === undefined) {
    throw new Error("The model did not call the submit tool");
  }

  try {
    return schema.parse(submitted.input);
  } catch (error) {
    throw new Error("Submitted data failed output schema validation", { cause: error });
  }
}
