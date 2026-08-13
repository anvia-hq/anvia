import type { JsonObject, JsonValue, ToolDefinition, ToolResultContent } from "../completion/types";
import {
  isToolResultContentArray,
  serializeToolResultOutput as serializeToolOutput,
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
  toolCallId?: string;
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
  includeToolCallDeltas?: boolean;
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

export type NormalizedToolOutput = string | ToolResultContent[];

export const ToolOutput = {
  content(content: ToolResultContent[]): ToolResultContent[] {
    return content;
  },
};

export { isToolResultContentArray, serializeToolOutput };

export function normalizeToolResultOutput(output: unknown): NormalizedToolOutput {
  return isToolResultContentArray(output) ? output : serializeToolOutput(output);
}

export function toolResultContentToText(content: ToolResultContent[]): string {
  return content
    .map((item) => (item.type === "text" ? item.text : `[image:${item.mediaType ?? "image/png"}]`))
    .join("\n");
}

export function parseToolArgs(args: string): JsonValue {
  if (args.trim() === "") {
    return {};
  }

  return JSON.parse(args) as JsonValue;
}
