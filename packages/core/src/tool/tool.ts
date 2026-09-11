import { isJsonValue } from "../completion/json";
import { parseMessage } from "../completion/message-schema";
import type {
  JsonObject,
  JsonValue,
  ToolDefinition,
  ToolResultContentPart,
  ToolResultOutput,
} from "../completion/types";

/** Identifies the agent run that requested a tool approval. */
export type ToolApprovalRunContext = {
  agentId: string;
  runId: string;
  sessionId?: string;
  metadata?: JsonObject;
};

/** Details of the pending tool call being evaluated for approval. */
export type ToolApprovalContext<Args = unknown> = {
  toolName: string;
  args: Args;
  /** The serialized argument string passed to hooks and approval checks. */
  rawArgs: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
  run: ToolApprovalRunContext;
};

/** An approval demand, with an optional human-readable reason. */
export type ToolApprovalRequirement = {
  reason?: string | undefined;
};

/**
 * Whether a tool call needs human approval before execution:
 *
 * - `boolean`: a static requirement
 * - `ToolApprovalRequirement`: a requirement with a reason
 * - a function: evaluated per call, receiving the parsed args and call context
 */
export type ToolRequiresApproval<Args = unknown> =
  | boolean
  | ToolApprovalRequirement
  | ((
      args: Args,
      context: ToolApprovalContext<Args>,
    ) => boolean | ToolApprovalRequirement | Promise<boolean | ToolApprovalRequirement>);

/** A child-agent event forwarded through a tool into the parent run's stream. */
export type ToolCallStreamEvent = {
  agentId: string;
  agentName?: string | undefined;
  event: unknown;
};

/** Execution context handed to a tool when the run invokes it. */
export type ToolCallContext = {
  /** Emits a child-agent event into the parent run's stream. */
  emitStreamEvent?(event: ToolCallStreamEvent): void | Promise<void>;
  /** Aborted when the run is cancelled or the stream consumer leaves. */
  abortSignal?: AbortSignal | undefined;
};

/**
 * A model-callable tool. `definition` builds the model-facing JSON description,
 * `call` executes it, and the optional `parseInput` converts raw model-supplied
 * JSON arguments into the typed `Args` before `call` runs.
 */
export interface Tool<Args = unknown, Output = unknown> {
  readonly name: string;
  readonly requiresApproval?: ToolRequiresApproval<Args>;
  definition(prompt: string): ToolDefinition | Promise<ToolDefinition>;
  call(args: Args, context?: ToolCallContext): Output | Promise<Output>;
  parseInput?(args: JsonValue): Args;
}

/** A tool with its argument and output types erased, e.g. as stored in an agent's catalog. */
export type AnyTool = Omit<Tool<unknown, unknown>, "requiresApproval"> & {
  readonly requiresApproval?: unknown;
};

const richToolOutput: unique symbol = Symbol.for("anvia.tool-output.content");

/**
 * A tool result carrying mixed content parts (text, files), created with
 * {@link ToolOutput.content}. The brand symbol keeps plain objects from
 * impersonating rich outputs.
 */
export type RichToolOutput = Readonly<{
  [richToolOutput]: true;
  content: readonly ToolResultContentPart[];
}>;

/** Normalized tool result as stored in tool messages. */
export type NormalizedToolOutput = ToolResultOutput;

/** Thrown when a tool returns a value that cannot be represented as a tool result. */
export class ToolResultSerializationError extends TypeError {
  constructor(readonly output: unknown) {
    super("Tool output must be a string, a strict JSON value, or ToolOutput.content(...).");
    this.name = "ToolResultSerializationError";
  }
}

/** Helpers for building tool results. */
export const ToolOutput = {
  /** Wraps content parts so a tool can return text and files together. */
  content(content: readonly ToolResultContentPart[]): RichToolOutput {
    return { [richToolOutput]: true, content };
  },
};

/**
 * Coerces a tool's return value into a normalized result: strings become text,
 * rich outputs are validated, and strict JSON values become JSON results.
 * Anything else throws {@link ToolResultSerializationError}.
 */
export function normalizeToolResultOutput(output: unknown): NormalizedToolOutput {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  if (isRichToolOutput(output)) {
    try {
      const message = parseMessage({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "validation",
            toolName: "validation",
            output: { type: "content", value: output.content },
          },
        ],
      });
      if (message.role !== "tool") throw new TypeError("Unexpected message role");
      const result = message.content[0];
      if (result?.type !== "tool-result") throw new TypeError("Unexpected tool result part");
      if (result?.output.type !== "content") throw new TypeError("Unexpected tool output");
      return result.output;
    } catch {
      throw new ToolResultSerializationError(output);
    }
  }
  if (isJsonValue(output)) {
    return { type: "json", value: output };
  }
  throw new ToolResultSerializationError(output);
}

/** Renders tool result content as text; file parts become `[file:<mediaType>]` placeholders. */
export function toolResultContentToText(content: readonly ToolResultContentPart[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text : `[file:${item.mediaType}]`))
    .join("\n");
}

function isRichToolOutput(value: unknown): value is RichToolOutput {
  if (typeof value !== "object" || value === null) return false;
  return Object.getOwnPropertyDescriptor(value, richToolOutput)?.value === true;
}

/** Parses and JSON-validates the raw argument string supplied by the model. */
export function parseToolArgs(args: string): JsonValue {
  const value: unknown = JSON.parse(args);
  if (!isJsonValue(value)) {
    throw new TypeError("Tool arguments must be a JSON value.");
  }
  return value;
}
