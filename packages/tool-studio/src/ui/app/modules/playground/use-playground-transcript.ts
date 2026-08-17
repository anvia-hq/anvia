import type { ClientStreamEvent } from "@anvia/client";
import type { ToolResultContentPart } from "@anvia/core/completion";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { StudioToolQuestionAnswer, StudioTranscriptChildAgentEvent } from "../../../../types";
import { formatToolValue } from "../shared/format";
import {
  findMatchingToolIndex,
  findMatchingToolIndexByCall,
  nextTranscriptId,
} from "../shared/transcript";
import type { ToolApprovalUpdate, ToolQuestionUpdate, TranscriptEntry } from "../shared/types";

type TranscriptToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
type TranscriptApproval = NonNullable<TranscriptToolEntry["approval"]>;
type TranscriptQuestion = NonNullable<TranscriptToolEntry["question"]>;

export function usePlaygroundTranscript(): {
  messages: TranscriptEntry[];
  setMessages: Dispatch<SetStateAction<TranscriptEntry[]>>;
  appendAgentToolEvent: (event: ClientStreamEvent) => void;
  appendAssistantError: (message: string) => void;
  appendAssistantText: (delta: string) => void;
  appendReasoningText: (delta: string, reasoningId: string | undefined) => void;
  appendToolCall: (toolName: string, args: string, callId: string | undefined) => void;
  appendToolResult: (props: {
    toolName: string;
    callId: string | undefined;
    args: string;
    result: string;
    structuredResult?: readonly ToolResultContentPart[];
  }) => void;
  assignAssistantTraceId: (traceId: string) => void;
  cancelPendingRun: (durationMs: number) => void;
  clearPendingAssistant: () => void;
  completeRun: (durationMs: number) => void;
  resolveToolApproval: (id: string, approved: boolean, reason?: string) => void;
  resolveToolQuestion: (id: string, answers: StudioToolQuestionAnswer[]) => void;
  updateToolApproval: (approval: ToolApprovalUpdate) => void;
  updateToolQuestion: (question: ToolQuestionUpdate) => void;
} {
  const [messages, setMessages] = useState<TranscriptEntry[]>([]);

  return {
    messages,
    setMessages,
    appendAgentToolEvent: (event) => setMessages((current) => appendAgentToolEvent(current, event)),
    appendAssistantError: (message) =>
      setMessages((current) => appendAssistantError(current, message)),
    appendAssistantText: (delta) => setMessages((current) => appendAssistantText(current, delta)),
    appendReasoningText: (delta, reasoningId) =>
      setMessages((current) => appendReasoningText(current, delta, reasoningId)),
    appendToolCall: (toolName, args, callId) =>
      setMessages((current) => appendToolCall(current, toolName, args, callId)),
    appendToolResult: (props) => setMessages((current) => appendToolResult(current, props)),
    assignAssistantTraceId: (traceId) =>
      setMessages((current) => assignAssistantTraceId(current, traceId)),
    cancelPendingRun: (durationMs) =>
      setMessages((current) =>
        cancelPendingTranscriptRun(current, new Date().toISOString(), durationMs),
      ),
    clearPendingAssistant: () => setMessages((current) => withoutPendingAssistant(current)),
    completeRun: (durationMs) =>
      setMessages((current) => completeTranscriptRun(current, durationMs)),
    resolveToolApproval: (id, approved, reason) =>
      setMessages((current) => resolveToolApproval(current, id, approved, reason)),
    resolveToolQuestion: (id, answers) =>
      setMessages((current) => resolveToolQuestion(current, id, answers)),
    updateToolApproval: (approval) =>
      setMessages((current) => updateToolApproval(current, approval)),
    updateToolQuestion: (question) =>
      setMessages((current) => updateToolQuestion(current, question)),
  };
}

function resolveToolApproval(
  entries: TranscriptEntry[],
  id: string,
  approved: boolean,
  reason?: string,
): TranscriptEntry[] {
  const next = [...entries];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry?.kind !== "tool" || entry.approval?.id !== id) continue;
    next[index] = {
      ...entry,
      approval: {
        ...entry.approval,
        status: approved ? "approved" : "rejected",
        resolvedAt: new Date().toISOString(),
        ...(reason === undefined ? {} : { reason }),
      },
    };
    break;
  }
  return next;
}

function resolveToolQuestion(
  entries: TranscriptEntry[],
  id: string,
  answers: StudioToolQuestionAnswer[],
): TranscriptEntry[] {
  const next = [...entries];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry?.kind !== "tool" || entry.question?.id !== id) continue;
    next[index] = {
      ...entry,
      question: {
        ...entry.question,
        status: "answered",
        answeredAt: new Date().toISOString(),
        answers,
      },
    };
    break;
  }
  return next;
}

export function cancelPendingTranscriptRun(
  entries: TranscriptEntry[],
  cancelledAt: string,
  durationMs: number,
): TranscriptEntry[] {
  const next = withoutPendingAssistant(entries);
  let currentTurnStart = -1;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry?.kind === "message" && entry.role === "user") {
      currentTurnStart = index;
      break;
    }
  }
  if (currentTurnStart < 0) {
    return completeTranscriptRun(next, durationMs);
  }

  for (let index = currentTurnStart + 1; index < next.length; index += 1) {
    const entry = next[index];
    if (entry?.kind !== "tool") {
      continue;
    }
    const updated: TranscriptToolEntry = { ...entry };
    if (entry.approval?.status === "pending") {
      updated.approval = {
        ...entry.approval,
        status: "cancelled",
        resolvedAt: cancelledAt,
        reason: "Run cancelled in Anvia Studio.",
      };
    }
    if (entry.question?.status === "pending") {
      updated.question = {
        ...entry.question,
        status: "cancelled",
        cancelledAt,
      };
    }
    next[index] = updated;
  }
  return completeTranscriptRun(next, durationMs);
}

export function completeTranscriptRun(
  entries: TranscriptEntry[],
  durationMs: number,
): TranscriptEntry[] {
  const next = [...entries];
  const normalizedDurationMs = Math.max(0, durationMs);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry?.kind === "message" && entry.role === "assistant") {
      if (entry.tone === "pending") {
        const { tone: _tone, ...completedEntry } = entry;
        next[index] = { ...completedEntry, durationMs: normalizedDurationMs };
      } else {
        next[index] = { ...entry, durationMs: normalizedDurationMs };
      }
      return next;
    }
    if (entry?.kind === "message" && entry.role === "user") {
      break;
    }
  }
  next.push({
    entryId: nextTranscriptId(),
    kind: "message",
    role: "assistant",
    text: "",
    durationMs: normalizedDurationMs,
  });
  return next;
}

function appendAssistantText(entries: TranscriptEntry[], delta: string): TranscriptEntry[] {
  const next = [...entries];
  const last = next.at(-1);
  if (last?.kind === "message" && last.role === "assistant") {
    if (last.tone === "pending") {
      const { tone: _tone, ...readyMessage } = last;
      next[next.length - 1] = { ...readyMessage, text: delta };
    } else {
      next[next.length - 1] = { ...last, text: `${last.text}${delta}` };
    }
  } else {
    next.push({
      entryId: nextTranscriptId(),
      kind: "message",
      role: "assistant",
      text: delta,
    });
  }
  return next;
}

function appendAssistantError(entries: TranscriptEntry[], message: string): TranscriptEntry[] {
  const next = [...entries];
  const last = next.at(-1);
  const entry = {
    entryId:
      last?.kind === "message" && last.role === "assistant" && last.tone === "pending"
        ? last.entryId
        : nextTranscriptId(),
    kind: "message" as const,
    role: "assistant" as const,
    text: message,
    tone: "error" as const,
  };
  if (last?.kind === "message" && last.role === "assistant" && last.tone === "pending") {
    next[next.length - 1] = entry;
    return next;
  }
  return [...next, entry];
}

function assignAssistantTraceId(entries: TranscriptEntry[], traceId: string): TranscriptEntry[] {
  const next = [...entries];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry?.kind === "message" && entry.role === "assistant") {
      next[index] = { ...entry, traceId };
      break;
    }
  }
  return next;
}

function updateToolApproval(
  entries: TranscriptEntry[],
  approval: ToolApprovalUpdate,
): TranscriptEntry[] {
  const next = withoutPendingAssistant(entries);
  const matchedIndex = findMatchingToolIndexByCall(next, approval.toolName, approval.callId);
  const approvalState = transcriptApproval(approval);
  if (matchedIndex < 0) {
    const entry: TranscriptToolEntry = {
      entryId: nextTranscriptId(),
      kind: "tool",
      toolName: approval.toolName,
      approval: approvalState,
    };
    if (approval.callId !== undefined) entry.callId = approval.callId;
    next.push(entry);
    return next;
  }

  const existing = next[matchedIndex];
  if (existing !== undefined && existing.kind === "tool") {
    next[matchedIndex] = {
      ...existing,
      approval: approvalState,
    };
  }
  return next;
}

function updateToolQuestion(
  entries: TranscriptEntry[],
  question: ToolQuestionUpdate,
): TranscriptEntry[] {
  const next = withoutPendingAssistant(entries);
  const matchedIndex = findMatchingToolIndexByCall(next, question.toolName, question.callId);
  const questionState = transcriptQuestion(question);
  if (matchedIndex < 0) {
    const entry: TranscriptToolEntry = {
      entryId: nextTranscriptId(),
      kind: "tool",
      toolName: question.toolName,
      question: questionState,
    };
    if (question.callId !== undefined) entry.callId = question.callId;
    next.push(entry);
    return next;
  }

  const existing = next[matchedIndex];
  if (existing !== undefined && existing.kind === "tool") {
    next[matchedIndex] = {
      ...existing,
      question: questionState,
    };
  }
  return next;
}

function transcriptApproval(approval: ToolApprovalUpdate): TranscriptApproval {
  const state: TranscriptApproval = {
    id: approval.id,
    status: approval.status,
    requestedAt: approval.requestedAt,
  };
  if (approval.resolvedAt !== undefined) state.resolvedAt = approval.resolvedAt;
  if (approval.reason !== undefined) state.reason = approval.reason;
  return state;
}

function transcriptQuestion(question: ToolQuestionUpdate): TranscriptQuestion {
  const state: TranscriptQuestion = {
    id: question.id,
    status: question.status,
    requestedAt: question.requestedAt,
    questions: question.questions,
  };
  if (question.answeredAt !== undefined) state.answeredAt = question.answeredAt;
  if (question.answers !== undefined) state.answers = question.answers;
  return state;
}

function appendReasoningText(
  entries: TranscriptEntry[],
  delta: string,
  reasoningId: string | undefined,
): TranscriptEntry[] {
  const next = withoutPendingAssistant(entries);
  const last = next.at(-1);
  if (last?.kind === "reasoning" && (last.reasoningId ?? "") === (reasoningId ?? "")) {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` };
  } else {
    const entry: Extract<TranscriptEntry, { kind: "reasoning" }> = {
      entryId: nextTranscriptId(),
      kind: "reasoning",
      text: delta,
    };
    if (reasoningId !== undefined) entry.reasoningId = reasoningId;
    next.push(entry);
  }
  return next;
}

function appendToolCall(
  entries: TranscriptEntry[],
  toolName: string,
  args: string,
  callId: string | undefined,
): TranscriptEntry[] {
  const entry: TranscriptToolEntry = {
    entryId: nextTranscriptId(),
    kind: "tool",
    toolName,
  };
  if (callId !== undefined) entry.callId = callId;
  if (args.length > 0) entry.args = args;
  return [...withoutPendingAssistant(entries), entry];
}

function appendToolResult(
  entries: TranscriptEntry[],
  props: {
    toolName: string;
    callId: string | undefined;
    args: string;
    result: string;
    structuredResult?: readonly ToolResultContentPart[];
  },
): TranscriptEntry[] {
  const next = withoutPendingAssistant(entries);
  const matchedIndex = findMatchingToolIndex(next, props.toolName, props.callId);
  if (matchedIndex >= 0) {
    const existing = next[matchedIndex];
    if (existing !== undefined && existing.kind === "tool") {
      const updated: TranscriptToolEntry = {
        ...existing,
        args: existing.args ?? props.args,
        result: props.result,
      };
      if (props.structuredResult !== undefined) updated.structuredResult = props.structuredResult;
      next[matchedIndex] = updated;
      return next;
    }
  }

  const entry: TranscriptToolEntry = {
    entryId: nextTranscriptId(),
    kind: "tool",
    toolName: props.toolName,
    args: props.args,
    result: props.result,
  };
  if (props.callId !== undefined) entry.callId = props.callId;
  if (props.structuredResult !== undefined) entry.structuredResult = props.structuredResult;
  next.push(entry);
  return next;
}

function appendAgentToolEvent(
  entries: TranscriptEntry[],
  event: ClientStreamEvent,
): TranscriptEntry[] {
  const scope = event.scope;
  if (scope?.agentId === undefined || scope.parentToolCallId === undefined) {
    return entries;
  }
  const childEvent = childAgentTranscriptEvent(event);
  if (childEvent === undefined) {
    return entries;
  }
  const next = withoutPendingAssistant(entries);
  const toolName = scope.parentToolName ?? "agent";
  const matchedIndex = findMatchingToolIndex(next, toolName, scope.parentToolCallId);
  if (matchedIndex < 0) {
    const entry: TranscriptToolEntry = {
      entryId: nextTranscriptId(),
      kind: "tool",
      toolName,
      childEvents: [childEvent],
    };
    entry.callId = scope.parentToolCallId;
    next.push(entry);
    return next;
  }

  const existing = next[matchedIndex];
  if (existing === undefined || existing.kind !== "tool") {
    return next;
  }
  const childEvents = [...(existing.childEvents ?? [])];
  appendChildAgentTranscriptEvent(childEvents, childEvent);
  next[matchedIndex] = {
    ...existing,
    childEvents,
  };
  return next;
}

function withoutPendingAssistant(entries: TranscriptEntry[]): TranscriptEntry[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.kind === "message" &&
      entry.role === "assistant" &&
      entry.tone === "pending" &&
      entry.text.trim().length === 0
    ) {
      return entries.filter((_, itemIndex) => itemIndex !== index);
    }
  }
  return [...entries];
}

function childAgentTranscriptEvent(
  event: ClientStreamEvent,
): StudioTranscriptChildAgentEvent | undefined {
  const scope = event.scope;
  if (scope?.agentId === undefined) return undefined;
  if (event.type === "text_delta") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "message" }> = {
      kind: "message",
      agentId: scope.agentId,
      text: event.delta,
    };
    if (scope.agentName !== undefined) entry.agentName = scope.agentName;
    return entry;
  }
  if (event.type === "reasoning_delta") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "reasoning" }> = {
      kind: "reasoning",
      agentId: scope.agentId,
      text: event.delta,
    };
    if (scope.agentName !== undefined) entry.agentName = scope.agentName;
    entry.reasoningId = event.partId;
    return entry;
  }
  if (event.type === "tool_call_end") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }> = {
      kind: "tool",
      agentId: scope.agentId,
      toolName: event.toolName,
      args: formatToolValue(event.input),
    };
    if (scope.agentName !== undefined) entry.agentName = scope.agentName;
    entry.callId = event.callId ?? event.toolCallId;
    return entry;
  }
  if (event.type === "tool_result") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }> = {
      kind: "tool",
      agentId: scope.agentId,
      toolName: event.toolName,
      args: formatToolValue(event.input),
      result:
        event.result.status === "success"
          ? formatToolValue(event.result.output)
          : event.result.error.message,
    };
    if (scope.agentName !== undefined) entry.agentName = scope.agentName;
    entry.callId = event.callId ?? event.toolCallId;
    if (event.result.status === "success" && event.result.content !== undefined) {
      entry.structuredResult = event.result.content;
    }
    return entry;
  }
  if (event.type === "error") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "message" }> = {
      kind: "message",
      agentId: scope.agentId,
      text: `Error: ${event.error.message}`,
    };
    if (scope.agentName !== undefined) entry.agentName = scope.agentName;
    return entry;
  }
  return undefined;
}

function appendChildAgentTranscriptEvent(
  childEvents: StudioTranscriptChildAgentEvent[],
  childEvent: StudioTranscriptChildAgentEvent,
) {
  if (childEvent.kind === "message") {
    const last = childEvents.at(-1);
    if (last?.kind === "message" && last.agentId === childEvent.agentId) {
      childEvents[childEvents.length - 1] = { ...last, text: `${last.text}${childEvent.text}` };
    } else {
      childEvents.push(childEvent);
    }
    return;
  }
  if (childEvent.kind === "reasoning") {
    const last = childEvents.at(-1);
    if (
      last?.kind === "reasoning" &&
      last.agentId === childEvent.agentId &&
      (last.reasoningId ?? "") === (childEvent.reasoningId ?? "")
    ) {
      childEvents[childEvents.length - 1] = { ...last, text: `${last.text}${childEvent.text}` };
    } else {
      childEvents.push(childEvent);
    }
    return;
  }
  const matchedIndex = findChildAgentToolEventIndex(childEvents, childEvent);
  if (matchedIndex < 0) {
    childEvents.push(childEvent);
    return;
  }
  const matched = childEvents[matchedIndex];
  if (matched?.kind === "tool") {
    const updated = { ...matched };
    if (matched.args === undefined && childEvent.args !== undefined) updated.args = childEvent.args;
    if (childEvent.result !== undefined) updated.result = childEvent.result;
    childEvents[matchedIndex] = updated;
  }
}

function findChildAgentToolEventIndex(
  childEvents: StudioTranscriptChildAgentEvent[],
  event: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }>,
): number {
  for (let index = childEvents.length - 1; index >= 0; index -= 1) {
    const childEvent = childEvents[index];
    if (
      childEvent?.kind !== "tool" ||
      childEvent.agentId !== event.agentId ||
      childEvent.toolName !== event.toolName ||
      childEvent.result !== undefined
    ) {
      continue;
    }
    if (event.callId === undefined || childEvent.callId === event.callId) {
      return index;
    }
  }
  return -1;
}
