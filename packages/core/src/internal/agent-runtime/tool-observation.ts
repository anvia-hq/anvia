import type { AgentChildStreamEvent } from "../../agent/run-types";
import type { JsonObject, ToolCallPart, ToolDefinition } from "../../completion";
import type { ToolHookArgs } from "../../hooks";
import { isMcpTool } from "../../mcp";
import type { ActiveToolObservers } from "../../observability/group";
import type {
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
  AgentToolSuspendedArgs,
} from "../../observability/types";
import type { AnyTool, ToolCallStreamEvent } from "../../tool";
import type { ToolApprovalRequest } from "./approval-request";
import { toolMayRequireApproval } from "./approval-requirement";

export type AgentToolEventPayload = {
  type: "agent_tool_event";
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  agentId: string;
  agentName?: string;
  event: AgentChildStreamEvent<unknown, unknown>;
};

export class ToolObserverScope {
  private terminal = false;

  constructor(private readonly observers: ActiveToolObservers | undefined) {}

  streamEvent(args: AgentToolStreamEventArgs): Promise<void> | undefined {
    return this.observers?.streamEvent(args);
  }

  async end(args: AgentToolEndArgs): Promise<void> {
    if (this.terminal) return;

    this.terminal = true;
    await this.observers?.end(args);
  }

  async suspend(args: AgentToolSuspendedArgs): Promise<void> {
    if (this.terminal) return;

    this.terminal = true;
    await this.observers?.suspend(args);
  }

  async error(args: AgentToolErrorArgs): Promise<void> {
    if (this.terminal) return;

    this.terminal = true;
    await this.observers?.error(args);
  }
}

export function buildToolHookArgs(
  toolCall: ToolCallPart,
  internalCallId: string,
  args: string,
): ToolHookArgs {
  const hookArgs: ToolHookArgs = {
    toolName: toolCall.toolName,
    toolCallId: toolCall.toolCallId,
    internalCallId,
    args,
  };

  if (toolCall.callId !== undefined) {
    hookArgs.callId = toolCall.callId;
  }

  return hookArgs;
}

export function buildToolStartArgs(
  turn: number,
  toolCall: ToolCallPart,
  internalCallId: string,
  args: string,
  tool: AnyTool | undefined,
  toolDefinitions?: readonly ToolDefinition[],
): AgentToolStartArgs {
  const toolDefinition = toolDefinitions?.find(
    (definition) => definition.name === toolCall.toolName,
  );
  const toolMetadata = toolTraceMetadata(tool);

  let toolStartArgs: AgentToolStartArgs = {
    turn,
    toolCall,
    toolName: toolCall.toolName,
    internalCallId,
    args,
  };

  if (toolCall.callId !== undefined) {
    toolStartArgs = { ...toolStartArgs, toolCallId: toolCall.callId };
  }

  if (toolDefinition !== undefined) toolStartArgs = { ...toolStartArgs, toolDefinition };

  if (toolMetadata !== undefined) toolStartArgs = { ...toolStartArgs, toolMetadata };

  return toolStartArgs;
}

export function toolErrorArgs(
  turn: number,
  toolCall: ToolCallPart,
  internalCallId: string,
  args: string,
  error: unknown,
): AgentToolErrorArgs {
  let observerArgs: AgentToolErrorArgs = {
    turn,
    toolCall,
    toolName: toolCall.toolName,
    internalCallId,
    args,
    error,
  };

  if (toolCall.callId !== undefined) {
    observerArgs = { ...observerArgs, toolCallId: toolCall.callId };
  }

  return observerArgs;
}

export function approvalEventAttributes(request: ToolApprovalRequest, turn: number): JsonObject {
  const attributes: JsonObject = {
    turn,
    approvalId: request.id,
    toolName: request.toolName,
    internalCallId: request.internalCallId,
  };

  if (request.toolCallId !== undefined) attributes.toolCallId = request.toolCallId;

  if (request.reason !== undefined) attributes.reason = request.reason;

  return attributes;
}

export function agentToolEventPayload(
  toolCall: ToolCallPart,
  internalCallId: string,
  event: ToolCallStreamEvent,
): AgentToolEventPayload | undefined {
  if (typeof event.agentId !== "string" || event.agentId.length === 0) {
    return undefined;
  }

  const payload: AgentToolEventPayload = {
    type: "agent_tool_event" as const,
    toolName: toolCall.toolName,
    internalCallId,
    agentId: event.agentId,
    event: event.event as AgentChildStreamEvent<unknown, unknown>,
  };

  if (toolCall.callId !== undefined) {
    payload.toolCallId = toolCall.callId;
  }

  if (event.agentName !== undefined) {
    payload.agentName = event.agentName;
  }

  return payload;
}

function toolTraceMetadata(tool: AnyTool | undefined): JsonObject | undefined {
  if (tool === undefined) {
    return undefined;
  }

  const result: JsonObject = {
    approvalRequired: toolMayRequireApproval(tool.requiresApproval),
  };

  if (isMcpTool(tool)) {
    result.mcpServerName = tool.mcp.serverName;
    result.mcpRemoteName = tool.mcp.remoteName;
  }

  return result;
}
