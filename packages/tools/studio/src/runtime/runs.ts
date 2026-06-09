import type { AgentStreamEvent } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { AgentTraceOptions } from "@anvia/core/observability";
import type { Context } from "hono";
import type {
  AgentRunRequest,
  AgentRunStreamEvent,
  StudioSession,
  StudioSessionStore,
  StudioTranscriptChildAgentEvent,
  StudioTranscriptEntry,
} from "../types";
import {
  errorResponse,
  isAgentTraceOptions,
  isJsonObject,
  isMessage,
  isMessageInput,
  isNonNegativeInteger,
  isObject,
  isPositiveInteger,
  serializeError,
} from "./shared";
import { streamStudioJsonl } from "./streams";

export class AsyncEventQueue<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver !== undefined) {
      resolver({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({ done: true, value: undefined });
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

export async function* mergeRunAndApprovalEvents(
  runEvents: AsyncIterable<AgentStreamEvent>,
  approvalEvents: AsyncEventQueue<AgentRunStreamEvent>,
): AsyncIterable<AgentRunStreamEvent> {
  type TaggedNext =
    | { source: "run"; value: IteratorResult<AgentStreamEvent> }
    | { source: "approval"; value: IteratorResult<AgentRunStreamEvent> };
  const runIterator = runEvents[Symbol.asyncIterator]();
  let runDone = false;
  let runNext: Promise<IteratorResult<AgentStreamEvent>> | undefined = runIterator.next();
  let approvalNext: Promise<IteratorResult<AgentRunStreamEvent>> | undefined =
    approvalEvents.next();

  try {
    while (runNext !== undefined || approvalNext !== undefined) {
      const pending: Promise<TaggedNext>[] = [];
      if (runNext !== undefined) {
        pending.push(runNext.then((value) => ({ source: "run", value })));
      }
      if (approvalNext !== undefined) {
        pending.push(approvalNext.then((value) => ({ source: "approval", value })));
      }

      const result = await Promise.race(pending);

      if (result.source === "run") {
        if (result.value.done === true) {
          runDone = true;
          runNext = undefined;
          approvalEvents.close();
        } else {
          runNext = runIterator.next();
          yield result.value.value;
        }
        continue;
      }

      if (result.value.done === true) {
        approvalNext = undefined;
      } else {
        approvalNext = approvalEvents.next();
        yield result.value.value;
      }
    }
  } finally {
    if (!runDone && runIterator.return !== undefined) {
      await runIterator.return();
    }
    approvalEvents.close();
  }
}

export function streamAgentRunEvents(
  _c: Context,
  events: AsyncIterable<AgentRunStreamEvent>,
): Response {
  return streamStudioJsonl(events);
}

export function traceForRun(
  trace: AgentTraceOptions | undefined,
  agentId: string,
  session: StudioSession | undefined,
): AgentTraceOptions {
  const metadata = {
    ...(trace?.metadata ?? {}),
    agentId,
  };
  return {
    ...(trace ?? {}),
    metadata,
    ...(trace?.sessionId !== undefined
      ? { sessionId: trace.sessionId }
      : session === undefined
        ? {}
        : { sessionId: session.id }),
  };
}

export async function* persistStreamingSessionTranscript(props: {
  stream: AsyncIterable<AgentRunStreamEvent>;
  store: StudioSessionStore;
  session: StudioSession;
  message: string | Message;
  runId: string;
}): AsyncIterable<AgentRunStreamEvent> {
  const transcript: StudioTranscriptEntry[] = [messageToTranscriptEntry(props.message, 0)];
  const title = optionalTitle(props.message);

  await props.store.saveSessionRunTranscript({
    id: props.session.id,
    runId: props.runId,
    ...title,
    transcript,
    status: "running",
  });

  try {
    for await (const event of props.stream) {
      acceptTranscriptStreamEvent(transcript, event);

      const nextSession = await props.store.saveSessionRunTranscript({
        id: props.session.id,
        runId: props.runId,
        ...title,
        transcript,
        status: event.type === "final" ? "success" : event.type === "error" ? "error" : "running",
        ...(event.type === "error" ? { error: serializeError(event.error) } : {}),
      });
      if (nextSession === undefined) {
        throw new Error("Session not found");
      }

      yield event;
    }
  } catch (error) {
    appendTranscriptAssistantError(transcript, errorText(error));
    await props.store.saveSessionRunTranscript({
      id: props.session.id,
      runId: props.runId,
      ...title,
      transcript,
      status: "error",
      error: serializeError(error),
    });
    throw error;
  }
}

function acceptTranscriptStreamEvent(
  transcript: StudioTranscriptEntry[],
  event: AgentRunStreamEvent,
): void {
  if (event.type === "text_delta") {
    appendTranscriptAssistantText(transcript, event.delta);
  }
  if (event.type === "reasoning_delta") {
    appendTranscriptReasoningText(transcript, event.delta, event.id);
  }
  if (event.type === "tool_call") {
    transcript.push({
      entryId: transcript.length,
      kind: "tool",
      toolName: event.toolCall.function.name,
      callId: event.toolCall.callId ?? event.toolCall.id,
      args: formatJson(event.toolCall.function.arguments),
    });
  }
  if (event.type === "tool_result") {
    const matched = findTranscriptToolEntry(transcript, event.toolName, event.toolCallId);
    if (matched === undefined) {
      transcript.push({
        entryId: transcript.length,
        kind: "tool",
        toolName: event.toolName,
        ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
        args: event.args,
        result: event.result,
        ...(event.structuredResult === undefined
          ? {}
          : { structuredResult: event.structuredResult }),
      });
      return;
    }
    matched.args = matched.args ?? event.args;
    matched.result = event.result;
    if (event.structuredResult !== undefined) {
      matched.structuredResult = event.structuredResult;
    }
  }
  if (event.type === "agent_tool_event") {
    const matched = findTranscriptToolEntry(transcript, event.toolName, event.toolCallId);
    if (matched === undefined) {
      transcript.push({
        entryId: transcript.length,
        kind: "tool",
        toolName: event.toolName,
        ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
        childEvents: [childAgentTranscriptEvent(event)].filter(
          (childEvent): childEvent is StudioTranscriptChildAgentEvent => childEvent !== undefined,
        ),
      });
      return;
    }
    appendChildAgentTranscriptEvent(matched, event);
  }
  if (event.type === "tool_approval_request") {
    const matched = findTranscriptToolEntry(
      transcript,
      event.approval.toolName,
      approvalCallId(event.approval),
    );
    if (matched !== undefined) {
      matched.approval = {
        id: event.approval.id,
        status: event.approval.status,
        requestedAt: event.approval.requestedAt,
      };
    }
  }
  if (event.type === "tool_approval_result") {
    const matched = findTranscriptToolEntry(
      transcript,
      event.approval.toolName,
      approvalCallId(event.approval),
    );
    if (matched !== undefined) {
      matched.approval = {
        id: event.approval.id,
        status: event.approval.status,
        requestedAt: event.approval.requestedAt,
        ...(event.approval.resolvedAt === undefined
          ? {}
          : { resolvedAt: event.approval.resolvedAt }),
        ...(event.approval.reason === undefined ? {} : { reason: event.approval.reason }),
      };
    }
  }
  if (event.type === "tool_question_request") {
    const matched = findTranscriptToolEntry(
      transcript,
      event.question.toolName,
      questionCallId(event.question),
    );
    if (matched !== undefined) {
      matched.question = {
        id: event.question.id,
        status: event.question.status,
        requestedAt: event.question.requestedAt,
        questions: event.question.questions,
      };
    }
  }
  if (event.type === "tool_question_result") {
    const matched = findTranscriptToolEntry(
      transcript,
      event.question.toolName,
      questionCallId(event.question),
    );
    if (matched !== undefined) {
      matched.question = {
        id: event.question.id,
        status: event.question.status,
        requestedAt: event.question.requestedAt,
        ...(event.question.answeredAt === undefined
          ? {}
          : { answeredAt: event.question.answeredAt }),
        questions: event.question.questions,
        ...(event.question.answers === undefined ? {} : { answers: event.question.answers }),
      };
    }
  }
  if (event.type === "final" && event.trace?.traceId !== undefined) {
    assignTranscriptTraceId(transcript, event.trace.traceId);
  }
  if (event.type === "error") {
    appendTranscriptAssistantError(transcript, errorText(event.error));
  }
}

function approvalCallId(approval: { callId?: string; toolCallId?: string }): string | undefined {
  return approval.callId ?? approval.toolCallId;
}

function questionCallId(question: { callId?: string; toolCallId?: string }): string | undefined {
  return question.callId ?? question.toolCallId;
}

function appendChildAgentTranscriptEvent(
  entry: Extract<StudioTranscriptEntry, { kind: "tool" }>,
  event: Extract<AgentRunStreamEvent, { type: "agent_tool_event" }>,
): void {
  const childEvent = childAgentTranscriptEvent(event);
  if (childEvent === undefined) {
    return;
  }
  const childEvents = entry.childEvents ?? [];
  if (childEvent.kind === "message") {
    const last = childEvents.at(-1);
    if (last?.kind === "message" && last.agentId === childEvent.agentId) {
      last.text = `${last.text}${childEvent.text}`;
    } else {
      childEvents.push(childEvent);
    }
  } else if (childEvent.kind === "reasoning") {
    const last = childEvents.at(-1);
    if (
      last?.kind === "reasoning" &&
      last.agentId === childEvent.agentId &&
      (last.reasoningId ?? "") === (childEvent.reasoningId ?? "")
    ) {
      last.text = `${last.text}${childEvent.text}`;
    } else {
      childEvents.push(childEvent);
    }
  } else {
    const matched = findChildAgentToolEvent(childEvents, childEvent);
    if (matched === undefined) {
      childEvents.push(childEvent);
    } else {
      if (matched.args === undefined && childEvent.args !== undefined) {
        matched.args = childEvent.args;
      }
      if (childEvent.result !== undefined) {
        matched.result = childEvent.result;
      }
    }
  }
  entry.childEvents = childEvents;
}

function childAgentTranscriptEvent(
  event: Extract<AgentRunStreamEvent, { type: "agent_tool_event" }>,
): StudioTranscriptChildAgentEvent | undefined {
  const child = event.event;
  if (child.type === "text_delta") {
    return {
      kind: "message",
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      text: child.delta,
    };
  }
  if (child.type === "reasoning_delta") {
    return {
      kind: "reasoning",
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      ...(child.id === undefined ? {} : { reasoningId: child.id }),
      text: child.delta,
    };
  }
  if (child.type === "tool_call") {
    return {
      kind: "tool",
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      toolName: child.toolCall.function.name,
      ...(child.toolCall.callId === undefined && child.toolCall.id === undefined
        ? {}
        : { callId: child.toolCall.callId ?? child.toolCall.id }),
      args: formatJson(child.toolCall.function.arguments),
    };
  }
  if (child.type === "tool_result") {
    return {
      kind: "tool",
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      toolName: child.toolName,
      ...(child.toolCallId === undefined ? {} : { callId: child.toolCallId }),
      args: child.args,
      result: child.result,
      ...(child.structuredResult === undefined ? {} : { structuredResult: child.structuredResult }),
    };
  }
  if (child.type === "error") {
    return {
      kind: "message",
      agentId: event.agentId,
      ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
      text: `Error: ${errorText(child.error)}`,
    };
  }
  return undefined;
}

function errorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(serializeError(error));
}

function findChildAgentToolEvent(
  childEvents: StudioTranscriptChildAgentEvent[],
  event: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }>,
): Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }> | undefined {
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
      return childEvent;
    }
  }
  return undefined;
}

export function transcriptFromMessages(messages: Message[]): StudioTranscriptEntry[] {
  const transcript: StudioTranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      for (const content of message.content) {
        if (content.type === "text") {
          transcript.push({
            entryId: transcript.length,
            kind: "message",
            role: "user",
            text: content.text,
          });
        }
      }
      continue;
    }
    if (message.role === "tool") {
      for (const content of message.content) {
        transcript.push({
          entryId: transcript.length,
          kind: "tool",
          toolName: "tool_result",
          callId: content.callId ?? content.id,
          result: content.content
            .map((item) =>
              "text" in item ? item.text : `[image:${item.mediaType ?? "image/png"}]`,
            )
            .join("\n"),
          structuredResult: content.content,
        });
      }
      continue;
    }

    for (const content of message.content) {
      if (content.type === "text") {
        appendTranscriptAssistantText(transcript, content.text);
      } else if (content.type === "reasoning") {
        appendTranscriptReasoningText(transcript, content.text, content.id);
      } else if (content.type === "tool_call") {
        transcript.push({
          entryId: transcript.length,
          kind: "tool",
          toolName: content.function.name,
          callId: content.callId ?? content.id,
          args: formatJson(content.function.arguments),
        });
      }
    }
  }
  return transcript;
}

function messageToTranscriptEntry(
  message: string | Message,
  entryId: number,
): StudioTranscriptEntry {
  const role = typeof message === "string" || message.role !== "assistant" ? "user" : "assistant";
  return {
    entryId,
    kind: "message",
    role,
    text: extractMessageText(message),
  };
}

function appendTranscriptAssistantText(transcript: StudioTranscriptEntry[], delta: string): void {
  const last = transcript.at(-1);
  if (last?.kind === "message" && last.role === "assistant" && last.tone !== "error") {
    last.text = `${last.text}${delta}`;
    return;
  }
  transcript.push({
    entryId: transcript.length,
    kind: "message",
    role: "assistant",
    text: delta,
  });
}

function appendTranscriptAssistantError(transcript: StudioTranscriptEntry[], text: string): void {
  const last = transcript.at(-1);
  if (
    last?.kind === "message" &&
    last.role === "assistant" &&
    last.tone === "error" &&
    last.text === text
  ) {
    return;
  }
  transcript.push({
    entryId: transcript.length,
    kind: "message",
    role: "assistant",
    text,
    tone: "error",
  });
}

function assignTranscriptTraceId(transcript: StudioTranscriptEntry[], traceId: string): void {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry?.kind === "message" && entry.role === "assistant") {
      transcript[index] = { ...entry, traceId };
      return;
    }
  }
}

function appendTranscriptReasoningText(
  transcript: StudioTranscriptEntry[],
  delta: string,
  reasoningId: string | undefined,
): void {
  const last = transcript.at(-1);
  if (last?.kind === "reasoning" && (last.reasoningId ?? "") === (reasoningId ?? "")) {
    last.text = `${last.text}${delta}`;
    return;
  }
  transcript.push({
    entryId: transcript.length,
    kind: "reasoning",
    ...(reasoningId === undefined ? {} : { reasoningId }),
    text: delta,
  });
}

function findTranscriptToolEntry(
  transcript: StudioTranscriptEntry[],
  toolName: string,
  callId: string | undefined,
): Extract<StudioTranscriptEntry, { kind: "tool" }> | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry?.kind !== "tool" || entry.toolName !== toolName || entry.result !== undefined) {
      continue;
    }
    if (callId === undefined || entry.callId === callId) {
      return entry;
    }
  }
  return undefined;
}

function titleFromMessage(message: string | Message): string | undefined {
  const text = extractMessageText(message).replace(/\s+/g, " ").trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

export function optionalTitle(message: string | Message): { title?: string } {
  const title = titleFromMessage(message);
  return title === undefined ? {} : { title };
}

function extractMessageText(message: string | Message): string {
  if (typeof message === "string") {
    return message;
  }
  if (message.role === "system") {
    return message.content;
  }
  return message.content
    .flatMap((item) => {
      if (item.type === "text" || item.type === "reasoning") {
        return [item.text];
      }
      if (item.type === "tool_call") {
        return [`${item.function.name}(${formatJson(item.function.arguments)})`];
      }
      if (item.type === "tool_result") {
        return item.content.map((result) =>
          "text" in result ? result.text : `[image:${result.mediaType ?? "image/png"}]`,
        );
      }
      return [];
    })
    .join("\n");
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function parseRunRequest(c: Context): Promise<AgentRunRequest | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }

  if (!("message" in body) || !isMessageInput(body.message)) {
    return {
      error: errorResponse(c, 400, "bad_request", "Request body requires a string or Message"),
    };
  }

  const request: AgentRunRequest = {
    message: typeof body.message === "string" ? body.message : body.message,
  };

  if ("history" in body) {
    if (!Array.isArray(body.history) || !body.history.every(isMessage)) {
      return { error: errorResponse(c, 400, "bad_request", "history must be a Message array") };
    }
    request.history = body.history;
  }

  if ("sessionId" in body) {
    if (typeof body.sessionId !== "string" || body.sessionId.trim().length === 0) {
      return { error: errorResponse(c, 400, "bad_request", "sessionId must be a string") };
    }
    if (request.history !== undefined) {
      return {
        error: errorResponse(c, 400, "bad_request", "sessionId cannot be combined with history"),
      };
    }
    request.sessionId = body.sessionId;
  }

  if ("stream" in body) {
    if (typeof body.stream !== "boolean") {
      return { error: errorResponse(c, 400, "bad_request", "stream must be a boolean") };
    }
    request.stream = body.stream;
  }

  if ("maxTurns" in body) {
    if (!isNonNegativeInteger(body.maxTurns)) {
      return {
        error: errorResponse(c, 400, "bad_request", "maxTurns must be a non-negative integer"),
      };
    }
    request.maxTurns = body.maxTurns;
  }

  if ("toolConcurrency" in body) {
    if (!isPositiveInteger(body.toolConcurrency)) {
      return {
        error: errorResponse(c, 400, "bad_request", "toolConcurrency must be a positive integer"),
      };
    }
    request.toolConcurrency = body.toolConcurrency;
  }

  if ("metadata" in body) {
    if (!isJsonObject(body.metadata)) {
      return { error: errorResponse(c, 400, "bad_request", "metadata must be an object") };
    }
    request.metadata = body.metadata;
  }

  if ("trace" in body) {
    if (!isAgentTraceOptions(body.trace)) {
      return {
        error: errorResponse(c, 400, "bad_request", "trace must be an AgentTraceOptions object"),
      };
    }
    request.trace = body.trace;
  }

  return request;
}
