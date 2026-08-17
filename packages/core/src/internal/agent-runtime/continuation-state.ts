import type { AgentInteractionRequest, AgentQuestionAnswer } from "../../agent/interactions";
import { parseAgentQuestionPrompts } from "../../agent/interactions";
import {
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type Message,
  parseMessages,
  type ToolCallPart,
  type ToolResultPart,
} from "../../completion";
import type { MemoryScope } from "../../memory";
import type { PendingToolExecution } from "./interaction-suspension";

export type QueuedSteering = {
  id: string;
  messages: Message[];
};

export type AgentContinuationState = {
  kind: "anvia.agent-continuation";
  history: Message[];
  messages: Message[];
  pending: PendingToolExecution;
  remainingToolCalls: ToolCallPart[];
  steering: QueuedSteering[];
  memoryScope?: MemoryScope;
};

export function serializeContinuationState(state: AgentContinuationState): JsonObject {
  const value = structuredClone(state) as unknown;
  if (!isJsonValue(value) || Array.isArray(value) || value === null) {
    throw new TypeError("Agent continuation state must be strict JSON.");
  }
  return value as JsonObject;
}

export function parseContinuationState(
  value: JsonObject,
  interaction: AgentInteractionRequest,
): AgentContinuationState {
  requireOnlyKeys(value, [
    "kind",
    "history",
    "messages",
    "pending",
    "remainingToolCalls",
    "steering",
    "memoryScope",
  ]);
  if (value.kind !== "anvia.agent-continuation") {
    throw new TypeError("Agent continuation has an unsupported internal state.");
  }
  const history = parseMessages(value.history);
  const messages = parseMessages(value.messages);
  const pending = parsePending(value.pending);
  const remainingToolCalls = parseToolCalls(value.remainingToolCalls);
  const steering = parseSteering(value.steering);
  if (
    pending.toolCall.toolCallId !== interaction.toolCallId ||
    pending.toolCall.toolName !== interaction.toolName ||
    pending.toolCall.callId !== interaction.callId ||
    pending.internalCallId !== interaction.internalCallId
  ) {
    throw new TypeError("Agent continuation interaction does not match its pending tool call.");
  }
  if (interaction.type === "tool-approval" && !jsonEqual(interaction.input, pending.input)) {
    throw new TypeError("Agent continuation approval input does not match its pending tool input.");
  }
  if (interaction.type === "tool-question") {
    const questions =
      object(pending.input) && "questions" in pending.input
        ? parseAgentQuestionPrompts(pending.input.questions)
        : undefined;
    if (questions === undefined || !jsonEqual(interaction.questions, questions)) {
      throw new TypeError(
        "Agent continuation questions do not match its pending question tool input.",
      );
    }
  }
  return {
    kind: "anvia.agent-continuation",
    history,
    messages,
    pending,
    remainingToolCalls,
    steering,
    ...(value.memoryScope === undefined
      ? {}
      : {
          memoryScope: parseOptionalJsonObject(value.memoryScope, "memoryScope") as MemoryScope,
        }),
  };
}

export function questionResult(
  answers: readonly AgentQuestionAnswer[],
): Extract<ToolResultPart["output"], { type: "json" }> {
  return { type: "json", value: { answers: structuredClone([...answers]) } };
}

function parsePending(value: unknown): PendingToolExecution {
  if (!object(value)) throw new TypeError("Agent continuation pending state is invalid.");
  const [toolCall] = parseToolCalls([value.toolCall]);
  if (toolCall === undefined) throw new TypeError("Agent continuation pending tool is missing.");
  if (typeof value.effectiveArgs !== "string" || typeof value.internalCallId !== "string") {
    throw new TypeError("Agent continuation pending execution metadata is invalid.");
  }
  return {
    toolCall,
    effectiveArgs: value.effectiveArgs,
    input: parseJsonValue(value.input, "pending input"),
    internalCallId: value.internalCallId,
    ...(typeof value.rejectMessage === "string" ? { rejectMessage: value.rejectMessage } : {}),
  };
}

function parseJsonValue(value: unknown, name: string): JsonValue {
  if (!isJsonValue(value)) {
    throw new TypeError(`Agent continuation ${name} is invalid.`);
  }
  return structuredClone(value);
}

function parseToolCalls(value: unknown): ToolCallPart[] {
  if (!Array.isArray(value)) throw new TypeError("Agent continuation tool calls must be an array.");
  const message = parseMessages([{ role: "assistant", content: value }])[0];
  if (message?.role !== "assistant" || typeof message.content === "string") {
    throw new TypeError("Agent continuation tool calls are invalid.");
  }
  if (!message.content.every((part) => part.type === "tool-call")) {
    throw new TypeError("Agent continuation contains a non-tool-call part.");
  }
  return message.content as ToolCallPart[];
}

function parseSteering(value: unknown): QueuedSteering[] {
  if (!Array.isArray(value)) throw new TypeError("Agent continuation steering state is invalid.");
  return value.map((item) => {
    if (!object(item) || typeof item.id !== "string") {
      throw new TypeError("Agent continuation steering entry is invalid.");
    }
    return { id: item.id, messages: parseMessages(item.messages) };
  });
}

function parseOptionalJsonObject(value: unknown, name: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !isJsonValue(value)) {
    throw new TypeError(`Agent continuation ${name} is invalid.`);
  }
  return structuredClone(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: JsonObject, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) {
    throw new TypeError(`Agent continuation state contains unknown key "${unknown}".`);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (object(left)) {
    if (!object(right)) return false;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && jsonEqual(left[key], right[key]))
    );
  }
  return false;
}
