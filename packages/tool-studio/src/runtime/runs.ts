import type { Message } from "@anvia/core/completion";
import type { AgentStreamEvent } from "@anvia/core/request";
import type { Context } from "hono";
import type {
  AgentRunRequest,
  AgentRunStreamEvent,
  AgentTraceOptions,
  StudioSession,
  StudioSessionStore,
  StudioTranscriptAttachment,
  StudioTranscriptChildAgentEvent,
  StudioTranscriptEntry,
} from "../types";
import { serializeError } from "./errors";
import { errorResponse } from "./http";
import { formatJson } from "./json";
import { streamStudioJsonl } from "./streams";
import {
  isAgentTraceOptions,
  isJsonObject,
  isMessage,
  isMessageInput,
  isNonNegativeInteger,
  isObject,
  isPositiveInteger,
} from "./type-guards";

export { transcriptFromMessages } from "./transcript";

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
  const options: AgentTraceOptions = {};
  if (trace !== undefined) Object.assign(options, trace);
  const metadata: Record<string, unknown> = {};
  if (trace?.metadata !== undefined) Object.assign(metadata, trace.metadata);
  metadata.agentId = agentId;
  options.metadata = metadata;
  if (trace?.sessionId !== undefined) options.sessionId = trace.sessionId;
  else if (session !== undefined) options.sessionId = session.id;
  return options;
}

export async function* persistStreamingSessionTranscript(props: {
  stream: AsyncIterable<AgentRunStreamEvent>;
  store: StudioSessionStore;
  session: StudioSession;
  message: string | Message;
  runId: string;
  persistGeneratedMessages?: boolean;
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

      const saveInput: Parameters<typeof props.store.saveSessionRunTranscript>[0] = {
        id: props.session.id,
        runId: props.runId,
        ...title,
        transcript,
        status: event.type === "final" ? "success" : event.type === "error" ? "error" : "running",
      };
      if (event.type === "error") saveInput.error = serializeError(event.error);
      const nextSession = await props.store.saveSessionRunTranscript(saveInput);
      if (nextSession === undefined) {
        throw new Error("Session not found");
      }
      const generatedMessages = event.type === "final" ? event.messages.slice(1) : [];
      if (props.persistGeneratedMessages === true && generatedMessages.length > 0) {
        await props.store.append({
          context: { sessionId: props.session.id },
          runId: props.runId,
          turn: 1,
          messages: generatedMessages,
        });
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
      const entry: Extract<StudioTranscriptEntry, { kind: "tool" }> = {
        entryId: transcript.length,
        kind: "tool",
        toolName: event.toolName,
      };
      if (event.toolCallId !== undefined) entry.callId = event.toolCallId;
      if (event.args !== undefined) entry.args = event.args;
      if (event.result !== undefined) entry.result = event.result;
      if (event.structuredResult !== undefined) entry.structuredResult = event.structuredResult;
      transcript.push(entry);
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
      const entry: Extract<StudioTranscriptEntry, { kind: "tool" }> = {
        entryId: transcript.length,
        kind: "tool",
        toolName: event.toolName,
        childEvents: [childAgentTranscriptEvent(event)].filter(
          (childEvent): childEvent is StudioTranscriptChildAgentEvent => childEvent !== undefined,
        ),
      };
      if (event.toolCallId !== undefined) entry.callId = event.toolCallId;
      transcript.push(entry);
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
      const approval: NonNullable<typeof matched.approval> = {
        id: event.approval.id,
        status: event.approval.status,
        requestedAt: event.approval.requestedAt,
      };
      if (event.approval.resolvedAt !== undefined) approval.resolvedAt = event.approval.resolvedAt;
      if (event.approval.reason !== undefined) approval.reason = event.approval.reason;
      matched.approval = approval;
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
      const question: NonNullable<typeof matched.question> = {
        id: event.question.id,
        status: event.question.status,
        requestedAt: event.question.requestedAt,
        questions: event.question.questions,
      };
      if (event.question.answeredAt !== undefined) question.answeredAt = event.question.answeredAt;
      if (event.question.answers !== undefined) question.answers = event.question.answers;
      matched.question = question;
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
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "message" }> = {
      kind: "message",
      agentId: event.agentId,
      text: child.delta,
    };
    if (event.agentName !== undefined) entry.agentName = event.agentName;
    return entry;
  }
  if (child.type === "reasoning_delta") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "reasoning" }> = {
      kind: "reasoning",
      agentId: event.agentId,
      text: child.delta,
    };
    if (event.agentName !== undefined) entry.agentName = event.agentName;
    if (child.id !== undefined) entry.reasoningId = child.id;
    return entry;
  }
  if (child.type === "tool_call") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }> = {
      kind: "tool",
      agentId: event.agentId,
      toolName: child.toolCall.function.name,
      callId: child.toolCall.callId ?? child.toolCall.id,
      args: formatJson(child.toolCall.function.arguments),
    };
    if (event.agentName !== undefined) entry.agentName = event.agentName;
    return entry;
  }
  if (child.type === "tool_result") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }> = {
      kind: "tool",
      agentId: event.agentId,
      toolName: child.toolName,
    };
    if (event.agentName !== undefined) entry.agentName = event.agentName;
    if (child.toolCallId !== undefined) entry.callId = child.toolCallId;
    if (child.args !== undefined) entry.args = child.args;
    if (child.result !== undefined) entry.result = child.result;
    if (child.structuredResult !== undefined) entry.structuredResult = child.structuredResult;
    return entry;
  }
  if (child.type === "error") {
    const entry: Extract<StudioTranscriptChildAgentEvent, { kind: "message" }> = {
      kind: "message",
      agentId: event.agentId,
      text: `Error: ${errorText(child.error)}`,
    };
    if (event.agentName !== undefined) entry.agentName = event.agentName;
    return entry;
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

function messageToTranscriptEntry(
  message: string | Message,
  entryId: number,
): StudioTranscriptEntry {
  const role = typeof message === "string" || message.role !== "assistant" ? "user" : "assistant";
  const entry: Extract<StudioTranscriptEntry, { kind: "message" }> = {
    entryId,
    kind: "message",
    role,
    text: extractMessageText(message),
  };
  if (role === "user") Object.assign(entry, optionalTranscriptAttachments(message));
  return entry;
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
  const entry: Extract<StudioTranscriptEntry, { kind: "reasoning" }> = {
    entryId: transcript.length,
    kind: "reasoning",
    text: delta,
  };
  if (reasoningId !== undefined) entry.reasoningId = reasoningId;
  transcript.push(entry);
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

function optionalTranscriptAttachments(message: string | Message): {
  attachments?: StudioTranscriptAttachment[];
} {
  if (typeof message === "string" || message.role !== "user") {
    return {};
  }
  const attachments = message.content.flatMap((content): StudioTranscriptAttachment[] => {
    if (content.type === "image") {
      const attachment: StudioTranscriptAttachment = { kind: "image" };
      if (content.source.type === "base64") {
        attachment.data = content.source.data;
        attachment.mediaType = content.source.mediaType;
      } else {
        attachment.url = content.source.url;
      }
      return [attachment];
    }
    if (content.type === "document") {
      const attachment: StudioTranscriptAttachment = { kind: "document" };
      if (content.source.filename !== undefined) attachment.name = content.source.filename;
      if (content.source.mediaType !== undefined) attachment.mediaType = content.source.mediaType;
      if (content.source.type === "base64") attachment.data = content.source.data;
      if (content.source.type === "url") attachment.url = content.source.url;
      return [attachment];
    }
    return [];
  });
  return attachments.length === 0 ? {} : { attachments };
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

  const request =
    "message" in body ? parseLegacyRunRequestBody(c, body) : parseUiRunRequestBody(c, body);
  if ("error" in request) {
    return request;
  }

  return parseRunRequestOptions(c, body, request);
}

function parseLegacyRunRequestBody(
  c: Context,
  body: Record<string, unknown>,
): AgentRunRequest | { error: Response } {
  if (!isMessageInput(body.message)) {
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

  return request;
}

function parseUiRunRequestBody(
  c: Context,
  body: Record<string, unknown>,
): AgentRunRequest | { error: Response } {
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.every(isMessage)) {
    return {
      error: errorResponse(c, 400, "bad_request", "messages must be a non-empty Message array"),
    };
  }

  if (messages.length === 0) {
    return {
      error: errorResponse(c, 400, "bad_request", "messages must be a non-empty Message array"),
    };
  }

  const message = messages.at(-1);
  if (message === undefined) {
    return {
      error: errorResponse(c, 400, "bad_request", "messages must be a non-empty Message array"),
    };
  }

  const history = messages.slice(0, -1);
  const request: AgentRunRequest = { message };
  if (history.length > 0) request.history = history;
  return request;
}

function parseRunRequestOptions(
  c: Context,
  body: Record<string, unknown>,
  request: AgentRunRequest,
): AgentRunRequest | { error: Response } {
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

  if ("model" in body) {
    if (typeof body.model === "string") {
      request.model = body.model;
    } else if (
      isObject(body.model) &&
      typeof body.model.provider === "string" &&
      typeof body.model.model === "string"
    ) {
      request.model = {
        provider: body.model.provider,
        model: body.model.model,
      };
    } else {
      return {
        error: errorResponse(
          c,
          400,
          "bad_request",
          "model must be a provider:model string or { provider, model } object",
        ),
      };
    }
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
