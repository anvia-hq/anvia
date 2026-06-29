import type { AgentDeltaEvent, AgentStreamEvent } from "../../request/types";

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

export function isGenerationDeltaEvent(type: string): boolean {
  return (
    type === "text_delta" ||
    type === "reasoning_delta" ||
    type === "tool_call_delta" ||
    type === "tool_call"
  );
}
