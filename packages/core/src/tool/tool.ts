import type { JsonObject, JsonValue, ToolDefinition } from "../completion/types";

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

export interface Tool<Args = unknown, Output = unknown> {
  readonly name: string;
  readonly approval?: ToolApprovalPolicy<Args>;
  definition(prompt: string): ToolDefinition | Promise<ToolDefinition>;
  call(args: Args): Output | Promise<Output>;
  parseApprovalArgs?(args: unknown): Args;
}

export type AnyTool = Omit<Tool<unknown, unknown>, "approval"> & {
  readonly approval?: unknown;
};

export function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  const serialized = JSON.stringify(output);
  return serialized === undefined ? String(output) : serialized;
}

export function parseToolArgs(args: string): JsonValue {
  if (args.trim() === "") {
    return {};
  }

  return JSON.parse(args) as JsonValue;
}
