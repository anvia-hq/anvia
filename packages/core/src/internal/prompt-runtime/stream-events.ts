import type { CompletionStreamEvent } from "../../completion/types";
import type {
  AgentDeltaEvent,
  AgentStreamEvent,
  AgentToolCallDeltaEvent,
} from "../../request/types";

export function addTurn(turn: number, event: AgentDeltaEvent): AgentStreamEvent {
  if (event.type === "text_delta") {
    return { type: "text_delta", turn, delta: event.delta };
  }
  if (event.type === "reasoning_delta") {
    const mapped: AgentStreamEvent = { type: "reasoning_delta", turn, delta: event.delta };
    if (event.id !== undefined) mapped.id = event.id;
    if (event.contentType !== undefined) mapped.contentType = event.contentType;
    if (event.signature !== undefined) mapped.signature = event.signature;
    return mapped;
  }
  return { type: "tool_call", turn, toolCall: event.toolCall };
}

export function addTurnToToolCallDelta(
  turn: number,
  event: Extract<CompletionStreamEvent, { type: "tool_call_delta" }>,
): AgentToolCallDeltaEvent {
  const mapped: AgentToolCallDeltaEvent = {
    type: "tool_call_delta",
    turn,
    id: event.id,
  };
  if (event.callId !== undefined) mapped.callId = event.callId;
  if (event.name !== undefined) mapped.name = event.name;
  if (event.argumentsDelta !== undefined) mapped.argumentsDelta = event.argumentsDelta;
  if (event.argumentsMode !== undefined) mapped.argumentsMode = event.argumentsMode;
  if (event.signature !== undefined) mapped.signature = event.signature;
  return mapped;
}

export function isGenerationDeltaEvent(type: string): boolean {
  return (
    type === "text_delta" ||
    type === "reasoning_delta" ||
    type === "tool_call_delta" ||
    type === "tool_call"
  );
}
