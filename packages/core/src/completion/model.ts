import type { ModelCallOptions } from "../model-call-options";
import { isJsonValue } from "./json";
import type { JsonObject } from "./json-types";
import type {
  AssistantContentPart,
  CompletionFinishReason,
  CompletionSource,
  Document,
  Message,
  ProviderToolCall,
  ReasoningContentType,
  ToolCallPart,
} from "./messages";
import {
  calculateContextUsage,
  type CompletionModelInfo,
  type ContextUsage,
  type ModelContextLimits,
  type Usage,
} from "./usage";

/**
 * How the model may call tools: freely, mandatorily, never, or a named function.
 * Requires the model's `toolChoice` capability.
 */
export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | {
      type: "function";
      name: string;
    };

/** JSON Schema-shaped tool description sent to the model (a local tool's public face). */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: JsonObject;
};

/**
 * A tool executed by the model provider rather than by Anvia's local tool runtime.
 *
 * Provider packages expose typed factories for these values. Application code can
 * pass them through the same high-level `tools` APIs used for local tools.
 */
export type ProviderTool = {
  kind: "provider";
  provider: string;
  name: string;
  configuration?: JsonObject;
};

export type CompletionTool = ToolDefinition | ProviderTool;

/** Narrows an unknown value to a well-formed {@link ProviderTool}. */
export function isProviderTool(value: unknown): value is ProviderTool {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ProviderTool>;
  return (
    candidate.kind === "provider" &&
    typeof candidate.provider === "string" &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    (candidate.configuration === undefined ||
      (typeof candidate.configuration === "object" &&
        candidate.configuration !== null &&
        !Array.isArray(candidate.configuration) &&
        isJsonValue(candidate.configuration)))
  );
}

/**
 * Throws a TypeError when a value declares itself a provider tool (`kind: "provider"`) but is not
 * well formed. Without this check such a value would fall through to the local tool list.
 */
export function assertProviderToolShape(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;

  if ((value as { kind?: unknown }).kind !== "provider" || isProviderTool(value)) return;

  const name = (value as { name?: unknown }).name;
  const label = typeof name === "string" && name.length > 0 ? `"${name}"` : "(unnamed)";
  throw new TypeError(
    `Provider tool ${label} is invalid: provider and name must be non-empty strings, and configuration must be a JSON object.`,
  );
}

/** Provider-agnostic completion request assembled by the runtime for adapters. */
export type CompletionRequest = {
  instructions?: string;
  chatHistory: Message[];
  documents: Document[];
  tools: ToolDefinition[];
  providerTools?: ProviderTool[];
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  /** Values for the model's declared completion controls; validated before sending. */
  controls?: Readonly<Record<string, string>>;
  /** Provider-specific passthrough options; never validated by the core runtime. */
  providerOptions?: JsonObject;
  /** JSON Schema the output must conform to; requires the `outputSchema` capability. */
  outputSchema?: JsonObject;
};

/** A provider's raw completion response: normalized parts plus usage and metadata. */
export type CompletionResponse<RawResponse = unknown> = {
  choice: AssistantContentPart[];
  usage: Usage;
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
  /** The provider SDK's original response object, unmodified. */
  rawResponse: RawResponse;
  messageId?: string;
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
};

/** Attaches context usage to a response when model limits are known. */
export function withContextUsage<RawResponse>(
  response: CompletionResponse<RawResponse>,
  model: CompletionModelInfo | undefined,
): CompletionResponse<RawResponse> {
  const contextUsage = calculateContextUsage(response.usage, model);
  return contextUsage === undefined ? response : { ...response, contextUsage };
}

/** Final result of a completion: typed output, plain text, full content, and usage. */
export type CompletionResult<Output = string, RawResponse = unknown> = {
  /**
   * The typed output. When an output schema was requested this is the parsed,
   * validated object; otherwise it is the plain text.
   */
  output: Output;
  /** The generated text, joined from the response's text parts. */
  text: string;
  /** Every content part the model produced, including reasoning and tool calls. */
  content: readonly AssistantContentPart[];
  usage: Usage;
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
  rawResponse: RawResponse;
  messageId?: string;
  sources?: readonly CompletionSource[];
  providerToolCalls?: readonly ProviderToolCall[];
};

/** Feature flags a model declares; requests are validated against these at runtime. */
export type CompletionModelCapabilities = {
  streaming: boolean;
  tools: boolean;
  toolChoice: boolean;
  forcedToolChoice?: boolean;
  imageInput: boolean;
  documentInput: boolean;
  outputSchema: boolean;
  reasoning: boolean;
  providerTools?: boolean;
  temperature?: boolean;
};

/** A selectable model control exposed to applications (e.g. "reasoning effort"). */
export type CompletionModelSelectControl<Option extends string = string> = Readonly<{
  type: "select";
  label: string;
  options: readonly Option[];
  description?: string | undefined;
  defaultValue?: Option | undefined;
}>;

/** Named set of controls a model supports, keyed by control id. */
export type CompletionModelControls = Readonly<
  Record<string, CompletionModelSelectControl<string>>
>;

/** Marker type for models that accept no completion controls. */
export type NoCompletionModelControls = Readonly<Record<string, never>>;

/** The option values a model's controls accept, keyed by control id. */
export type CompletionControlValues<Controls extends CompletionModelControls> = Readonly<
  Partial<{
    [Key in keyof Controls]: Controls[Key] extends CompletionModelSelectControl<infer Option>
      ? Option
      : never;
  }>
>;

/** Extracts a model's control types, defaulting to the open controls record. */
export type CompletionModelControlsOf<Model> =
  Model extends CompletionModel<unknown, infer Controls> ? Controls : CompletionModelControls;

/**
 * The provider-agnostic model contract every adapter implements: non-streaming
 * completions plus capability, context, and control metadata.
 */
export interface CompletionModel<
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> {
  readonly provider: string;
  readonly modelId: string;
  readonly contextLimits?: ModelContextLimits | undefined;
  readonly capabilities: CompletionModelCapabilities;
  readonly controls?: Controls | undefined;
  /**
   * Returns a JSON-safe representation of the outgoing request for
   * observability traces, or undefined to omit the trace payload. Errors
   * thrown here are swallowed by the runtime and recorded as a trace error.
   */
  traceRequest?(
    request: CompletionRequest,
    options?: { stream?: boolean | undefined },
  ): JsonObject | undefined;
  completion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): Promise<CompletionResponse<RawResponse>>;
}

/** How a `tool_call_delta` updates arguments: append to, or replace, accumulated JSON. */
export type ToolCallArgumentsMode = "append" | "replace";

/**
 * Incremental completion stream content:
 *
 * - `text_delta` / `reasoning_delta`: incremental text or reasoning content
 * - `tool_call_delta`: partial tool call input; argument fragments accumulate
 *   according to `argumentsMode` (`append` continues the JSON string, `replace`
 *   restarts it)
 * - `tool_call`: a complete tool call
 * - `source`: a grounding source discovered during generation
 * - `provider_tool_call`: progress on a provider-executed tool
 * - `message_id`: the id of the message being generated
 */
export type CompletionStreamPart =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      /** Provider signature preserved for reasoning replay. */
      signature?: string;
    }
  | {
      type: "tool_call_delta";
      id: string;
      callId?: string;
      name?: string;
      argumentsDelta?: string;
      argumentsMode?: ToolCallArgumentsMode;
      signature?: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCallPart;
    }
  | {
      type: "source";
      source: CompletionSource;
    }
  | {
      type: "provider_tool_call";
      toolCall: ProviderToolCall;
    }
  | {
      type: "message_id";
      id: string;
    };

/** Raw model stream events: stream parts, the final response, or a terminal error. */
export type CompletionModelStreamEvent<RawResponse = unknown> =
  | CompletionStreamPart
  | {
      type: "final";
      response: CompletionResponse<RawResponse>;
    }
  | {
      type: "error";
      error: unknown;
      usage?: Usage;
    };

/** High-level stream events: stream parts, the final typed result, or a terminal error. */
export type CompletionStreamEvent<Output = string, RawResponse = unknown> =
  | CompletionStreamPart
  | {
      type: "final";
      result: CompletionResult<Output, RawResponse>;
    }
  | {
      type: "error";
      error: unknown;
      usage: Usage;
    };

/** A completion model that can additionally stream events as they are produced. */
export interface StreamingCompletionModel<
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> extends CompletionModel<RawResponse, Controls> {
  streamCompletion(
    request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent<RawResponse>>;
}
