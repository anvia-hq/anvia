import type { AgentInteractionRequest, AgentToolApprovalRequest } from "../../agent/interactions";
import {
  isJsonValue,
  type JsonValue,
  type ToolCallPart,
  type ToolResultPart,
} from "../../completion";

export type PendingToolExecution = {
  toolCall: ToolCallPart;
  effectiveArgs: string;
  input: JsonValue;
  internalCallId: string;
  rejectMessage?: string;
};

export class AgentInteractionSignal extends Error {
  constructor(
    readonly interaction: AgentInteractionRequest,
    readonly rejectMessage?: string,
  ) {
    super("Agent execution requires a human interaction.");
    this.name = "AgentInteractionSignal";
  }
}

export class ToolExecutionSuspension extends Error {
  completedResults: ToolResultPart[] = [];
  remainingToolCalls: ToolCallPart[] = [];

  constructor(
    readonly interaction: AgentInteractionRequest,
    readonly pending: PendingToolExecution,
  ) {
    super("Tool execution suspended for human interaction.");
    this.name = "ToolExecutionSuspension";
  }
}

export function approvalInteraction(request: {
  id: string;
  toolName: string;
  toolCallId?: string;
  callId?: string;
  internalCallId: string;
  args: unknown;
  reason?: string | undefined;
  rejectMessage?: string | undefined;
}): AgentToolApprovalRequest {
  if (request.toolCallId === undefined) {
    throw new TypeError("Tool approval requires a canonical toolCallId.");
  }
  if (!isJsonValue(request.args)) {
    throw new TypeError("Tool approval input must be strict JSON.");
  }
  let interaction: AgentToolApprovalRequest = {
    type: "tool-approval",
    id: request.id,
    toolName: request.toolName,
    toolCallId: request.toolCallId,
    internalCallId: request.internalCallId,
    input: request.args,
  };
  if (request.callId !== undefined) interaction = { ...interaction, callId: request.callId };
  if (request.reason !== undefined) interaction = { ...interaction, reason: request.reason };
  return interaction;
}
