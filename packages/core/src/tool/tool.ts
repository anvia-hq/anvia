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

export type ToolApprovalPolicy<Args = unknown> = {
  when(ctx: ToolApprovalContext<Args>): boolean | Promise<boolean>;
  reason?: string | ((ctx: ToolApprovalContext<Args>) => string | Promise<string>);
  rejectMessage?: string | ((ctx: ToolApprovalContext<Args>) => string | Promise<string>);
};

export type ToolCallStreamEvent = {
  agentId: string;
  agentName?: string | undefined;
  event: unknown;
};

export type ToolCallContext = {
  emitStreamEvent?(event: ToolCallStreamEvent): void | Promise<void>;
};

export interface Tool<Args = unknown, Output = unknown> {
  readonly name: string;
  readonly approval?: ToolApprovalPolicy<Args>;
  definition(prompt: string): ToolDefinition | Promise<ToolDefinition>;
  call(args: Args, context?: ToolCallContext): Output | Promise<Output>;
  parseApprovalArgs?(args: unknown): Args;
}

export type AnyTool = Omit<Tool<unknown, unknown>, "approval"> & {
  readonly approval?: unknown;
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
