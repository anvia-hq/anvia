import { isJsonValue } from "../completion/json";
import { parseMessage } from "../completion/message-schema";
import type {
  JsonObject,
  JsonValue,
  ToolDefinition,
  ToolResultContentPart,
  ToolResultOutput,
} from "../completion/types";

export type ToolApprovalRunContext = {
  agentId: string;
  runId: string;
  sessionId?: string;
  metadata?: JsonObject;
};

export type ToolApprovalContext<Args = unknown> = {
  toolName: string;
  args: Args;
  rawArgs: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
  run: ToolApprovalRunContext;
};

export type ToolApprovalRequirement = {
  reason?: string | undefined;
};

export type ToolRequiresApproval<Args = unknown> =
  | boolean
  | ToolApprovalRequirement
  | ((
      args: Args,
      context: ToolApprovalContext<Args>,
    ) => boolean | ToolApprovalRequirement | Promise<boolean | ToolApprovalRequirement>);

export type ToolCallStreamEvent = {
  agentId: string;
  agentName?: string | undefined;
  event: unknown;
};

export type ToolCallContext = {
  emitStreamEvent?(event: ToolCallStreamEvent): void | Promise<void>;
  abortSignal?: AbortSignal | undefined;
};

export interface Tool<Args = unknown, Output = unknown> {
  readonly name: string;
  readonly requiresApproval?: ToolRequiresApproval<Args>;
  definition(prompt: string): ToolDefinition | Promise<ToolDefinition>;
  call(args: Args, context?: ToolCallContext): Output | Promise<Output>;
  parseInput?(args: JsonValue): Args;
}

export type AnyTool = Omit<Tool<unknown, unknown>, "requiresApproval"> & {
  readonly requiresApproval?: unknown;
};

const richToolOutput: unique symbol = Symbol.for("anvia.tool-output.content");

export type RichToolOutput = Readonly<{
  [richToolOutput]: true;
  content: readonly ToolResultContentPart[];
}>;

export type NormalizedToolOutput = ToolResultOutput;

export class ToolResultSerializationError extends TypeError {
  constructor(readonly output: unknown) {
    super("Tool output must be a string, a strict JSON value, or ToolOutput.content(...).");
    this.name = "ToolResultSerializationError";
  }
}

export const ToolOutput = {
  content(content: readonly ToolResultContentPart[]): RichToolOutput {
    return { [richToolOutput]: true, content };
  },
};

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

export function toolResultContentToText(content: readonly ToolResultContentPart[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text : `[file:${item.mediaType}]`))
    .join("\n");
}

function isRichToolOutput(value: unknown): value is RichToolOutput {
  if (typeof value !== "object" || value === null) return false;
  return Object.getOwnPropertyDescriptor(value, richToolOutput)?.value === true;
}

export function parseToolArgs(args: string): JsonValue {
  const value: unknown = JSON.parse(args);
  if (!isJsonValue(value)) {
    throw new TypeError("Tool arguments must be a JSON value.");
  }
  return value;
}
