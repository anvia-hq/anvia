import {
  type AgentClientStreamContext,
  type ClientStreamEvent,
  customAgentEventsToClientStream,
} from "@anvia/client";
import type { AgentStreamEvent } from "@anvia/core/agent";
import { parseAgentInteractionResponse } from "@anvia/core/agent/interactions";
import {
  isJsonValue,
  type JsonObject,
  type Message,
  parseMessages,
  type ToolResultOutput,
} from "@anvia/core/completion";
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
import { streamStudioClient } from "./streams";
import {
  isAgentTraceOptions,
  isJsonObject,
  isNonNegativeInteger,
  isObject,
  isPositiveInteger,
} from "./type-guards";

export { transcriptFromMessages } from "./transcript";

export type TranslatedAgentStreamEvent = AgentStreamEvent;

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

export function streamAgentRunEvents(
  _c: Context,
  events: AsyncIterable<AgentRunStreamEvent>,
  options: { runId: string; onCancel?: () => void | Promise<void> },
): Response {
  return streamStudioClient({
    events: customAgentEventsToClientStream<AgentRunStreamEvent>({
      events: withAgentRunCancellation(events, options.onCancel),
      runId: options.runId,
      mapCustomEvent: studioEventToClientEvent,
    }),
  });
}

function studioEventToClientEvent(
  event: AgentRunStreamEvent,
  context: AgentClientStreamContext,
): ClientStreamEvent | undefined {
  if (event.type === "session_log" && isJsonValue(event.log)) {
    return {
      type: "data",
      runId: context.runId,
      name: "studio.session_log",
      data: event.log,
      transient: true,
    };
  }
  if (event.type === "pipeline_log" && isJsonValue(event.log)) {
    return {
      type: "data",
      runId: context.runId,
      name: "studio.pipeline_log",
      data: event.log,
      transient: true,
    };
  }
  if (event.type === "pipeline_final" && isJsonValue(event.output)) {
    return {
      type: "data",
      runId: context.runId,
      name: "studio.pipeline_final",
      data: event.output,
    };
  }
  return undefined;
}

function withAgentRunCancellation(
  events: AsyncIterable<AgentRunStreamEvent>,
  onCancel: (() => void | Promise<void>) | undefined,
): AsyncIterable<AgentRunStreamEvent> {
  const iterator = events[Symbol.asyncIterator]();
  let done = false;
  let terminal = false;
  let cancellationHandled = false;

  const handleCancellation = async () => {
    if (cancellationHandled) {
      return;
    }
    cancellationHandled = true;
    await onCancel?.();
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<AgentRunStreamEvent> {
      return {
        async next(): Promise<IteratorResult<AgentRunStreamEvent>> {
          if (done) {
            return { done: true, value: undefined };
          }
          try {
            const next = await iterator.next();
            if (next.done === true) {
              done = true;
              if (!terminal) {
                await handleCancellation();
              }
              return next;
            }
            if (next.value.type === "final" || next.value.type === "error") {
              terminal = true;
            }
            return next;
          } catch (error) {
            done = true;
            terminal = true;
            throw error;
          }
        },
        async return(): Promise<IteratorResult<AgentRunStreamEvent>> {
          if (done) {
            return { done: true, value: undefined };
          }
          done = true;
          let closeError: unknown;
          const closePromise = iterator.return?.().catch((error: unknown) => {
            closeError = error;
            return { done: true, value: undefined } as IteratorResult<AgentRunStreamEvent>;
          });
          if (!terminal) {
            await handleCancellation();
          }
          await closePromise;
          if (closeError !== undefined) {
            throw closeError;
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export function traceForRun(
  trace: AgentTraceOptions | undefined,
  agentId: string,
  session: StudioSession | undefined,
): AgentTraceOptions {
  const options: AgentTraceOptions = {};
  if (trace !== undefined) Object.assign(options, trace);
  const metadata: JsonObject = {};
  if (trace?.metadata !== undefined) Object.assign(metadata, trace.metadata);
  metadata.agentId = agentId;
  options.metadata = metadata;
  if (trace?.sessionId !== undefined) options.sessionId = trace.sessionId;
  else if (session !== undefined) options.sessionId = session.id;
  return options;
}

export function createPersistedStreamingSessionTranscript(props: {
  stream: AsyncIterable<AgentRunStreamEvent>;
  store: StudioSessionStore;
  session: StudioSession;
  message: string | Message;
  runId: string;
  startedAt: number;
  persistGeneratedMessages?: boolean;
  generatedMessagesStartIndex?: 0 | 1;
}): {
  events: AsyncIterable<AgentRunStreamEvent>;
  cancel: () => Promise<void>;
} {
  const transcript: StudioTranscriptEntry[] = [messageToTranscriptEntry(props.message, 0)];
  const title = optionalTitle(props.message);
  let status: "running" | "success" | "suspended" | "error" | "cancelled" = "running";
  let saveTail: Promise<void> = Promise.resolve();
  const isCancelled = () => status === "cancelled";

  const saveTranscript = (
    input: Parameters<typeof props.store.saveSessionRunTranscript>[0],
  ): Promise<void> => {
    const operation = saveTail.then(async () => {
      const nextSession = await props.store.saveSessionRunTranscript(input);
      if (nextSession === undefined) {
        throw new Error("Session not found");
      }
    });
    saveTail = operation.catch(() => undefined);
    return operation;
  };

  const events = (async function* (): AsyncIterable<AgentRunStreamEvent> {
    await saveTranscript({
      id: props.session.id,
      runId: props.runId,
      ...title,
      transcript,
      status: "running",
    });
    if (isCancelled()) {
      return;
    }

    try {
      for await (const event of props.stream) {
        if (isCancelled()) {
          return;
        }
        acceptTranscriptStreamEvent(transcript, event);
        if (event.type === "final" || event.type === "error") {
          assignTranscriptRunDuration(transcript, Date.now() - props.startedAt);
        }
        const eventStatus =
          event.type === "final"
            ? event.result.status === "suspended"
              ? "suspended"
              : "success"
            : event.type === "error"
              ? "error"
              : "running";

        const saveInput: Parameters<typeof props.store.saveSessionRunTranscript>[0] = {
          id: props.session.id,
          runId: props.runId,
          ...title,
          transcript,
          status: eventStatus,
        };
        if (event.type === "error") saveInput.error = serializeError(event.error);
        await saveTranscript(saveInput);
        const generatedMessages =
          event.type === "final"
            ? event.result.messages.slice(props.generatedMessagesStartIndex ?? 1)
            : [];
        if (props.persistGeneratedMessages === true && generatedMessages.length > 0) {
          await props.store.append({
            scope: { sessionId: props.session.id },
            runId: props.runId,
            turn: 1,
            messages: generatedMessages,
          });
        }
        if (isCancelled()) {
          return;
        }
        status = eventStatus;

        yield event;
      }
    } catch (error) {
      if (status !== "running") {
        throw error;
      }
      status = "error";
      appendTranscriptAssistantError(transcript, errorText(error));
      assignTranscriptRunDuration(transcript, Date.now() - props.startedAt);
      await saveTranscript({
        id: props.session.id,
        runId: props.runId,
        ...title,
        transcript,
        status: "error",
        error: serializeError(error),
      });
      throw error;
    }
  })();

  return {
    events,
    async cancel() {
      if (status !== "running") {
        return;
      }
      status = "cancelled";
      cancelPendingTranscriptInputs(transcript, new Date().toISOString());
      assignTranscriptRunDuration(transcript, Date.now() - props.startedAt);
      await saveTranscript({
        id: props.session.id,
        runId: props.runId,
        ...title,
        transcript,
        status: "cancelled",
      });
    },
  };
}

export function assignTranscriptRunDuration(
  transcript: StudioTranscriptEntry[],
  durationMs: number,
): void {
  const normalizedDurationMs = Math.max(0, durationMs);
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry?.kind === "message" && entry.role === "assistant") {
      entry.durationMs = normalizedDurationMs;
      return;
    }
    if (entry?.kind === "message" && entry.role === "user") {
      break;
    }
  }
  transcript.push({
    entryId: transcript.length,
    kind: "message",
    role: "assistant",
    text: "",
    durationMs: normalizedDurationMs,
  });
}

function cancelPendingTranscriptInputs(
  transcript: StudioTranscriptEntry[],
  cancelledAt: string,
): void {
  for (const entry of transcript) {
    if (entry.kind !== "tool") {
      continue;
    }
    if (entry.approval?.status === "pending") {
      entry.approval = {
        ...entry.approval,
        status: "cancelled",
        resolvedAt: cancelledAt,
        reason: "Run cancelled in Anvia Studio.",
      };
    }
    if (entry.question?.status === "pending") {
      entry.question = {
        ...entry.question,
        status: "cancelled",
        cancelledAt,
      };
    }
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
      toolName: event.toolCall.toolName,
      callId: event.toolCall.callId ?? event.toolCall.toolCallId,
      args: formatJson(event.toolCall.input),
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
  if (event.type === "final" && event.result.status === "suspended") {
    const interaction = event.result.interaction;
    const matched = findTranscriptToolEntry(
      transcript,
      interaction.toolName,
      interaction.callId ?? interaction.toolCallId,
    );
    if (matched !== undefined && interaction.type === "tool-approval") {
      const approval: NonNullable<typeof matched.approval> = {
        id: interaction.id,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      if (interaction.reason !== undefined) approval.reason = interaction.reason;
      matched.approval = approval;
    }
    if (matched !== undefined && interaction.type === "tool-question") {
      matched.question = {
        id: interaction.id,
        status: "pending",
        requestedAt: new Date().toISOString(),
        questions: interaction.questions.map((question) => ({
          id: question.id,
          question: question.text,
          choices: [...(question.choices ?? [])],
          allowCustom: question.choices === undefined || question.allowCustom === true,
        })),
      };
    }
  }
  if (event.type === "interaction_response") {
    const response = event.response;
    const matched = findTranscriptToolEntry(
      transcript,
      response.toolName,
      response.callId ?? response.toolCallId,
    );
    const respondedAt = new Date().toISOString();
    if (matched?.approval !== undefined && response.type === "tool-approval-response") {
      const approval: NonNullable<typeof matched.approval> = {
        ...matched.approval,
        status: response.approved ? "approved" : "rejected",
        resolvedAt: respondedAt,
      };
      if (response.reason !== undefined) approval.reason = response.reason;
      matched.approval = approval;
    }
    if (matched?.question !== undefined && response.type === "tool-question-response") {
      matched.question = {
        ...matched.question,
        status: "answered",
        answeredAt: respondedAt,
        answers: response.answers.map((answer) => ({
          questionId: answer.questionId,
          answer: answer.value,
        })),
      };
    }
  }
  if (event.type === "final" && event.result.trace?.traceId !== undefined) {
    assignTranscriptTraceId(transcript, event.result.trace.traceId);
  }
  if (event.type === "error") {
    appendTranscriptAssistantError(transcript, errorText(event.error));
  }
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
      toolName: child.toolCall.toolName,
      callId: child.toolCall.callId ?? child.toolCall.toolCallId,
      args: formatJson(child.toolCall.input),
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
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((item) => {
      if (item.type === "text" || item.type === "reasoning") {
        return [item.text];
      }
      if (item.type === "tool-call") {
        return [`${item.toolName}(${formatJson(item.input)})`];
      }
      if (item.type === "tool-result") {
        return [toolResultOutputText(item.output)];
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
  if (typeof message.content === "string") {
    return {};
  }
  const attachments = message.content.flatMap((content): StudioTranscriptAttachment[] => {
    if (content.type === "image") {
      const attachment: StudioTranscriptAttachment = { kind: "image" };
      if (content.image.type === "data") {
        attachment.data = content.image.data;
        if (content.mediaType !== undefined) attachment.mediaType = content.mediaType;
      } else {
        attachment.url = content.image.url;
      }
      return [attachment];
    }
    if (content.type === "file") {
      const attachment: StudioTranscriptAttachment = { kind: "document" };
      if (content.filename !== undefined) attachment.name = content.filename;
      attachment.mediaType = content.mediaType;
      if (content.data.type === "data") attachment.data = content.data.data;
      if (content.data.type === "url") attachment.url = content.data.url;
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

  if ("message" in body || "history" in body) {
    return {
      error: errorResponse(
        c,
        400,
        "bad_request",
        "Legacy message/history requests are not supported; use messages",
      ),
    };
  }

  const request = parseRunRequestBody(c, body);
  if ("error" in request) {
    return request;
  }

  return parseRunRequestOptions(c, body, request);
}

function parseRunRequestBody(
  c: Context,
  body: Record<string, unknown>,
): AgentRunRequest | { error: Response } {
  if (body.type === "interaction_response") {
    if (typeof body.interactionId !== "string" || body.interactionId.trim().length === 0) {
      return { error: errorResponse(c, 400, "bad_request", "interactionId must be a string") };
    }
    if (body.messages !== undefined || body.sessionId !== undefined || body.model !== undefined) {
      return {
        error: errorResponse(
          c,
          400,
          "bad_request",
          "Interaction responses cannot include messages, sessionId, or model",
        ),
      };
    }
    try {
      return {
        type: "interaction_response",
        interactionId: body.interactionId,
        response: parseAgentInteractionResponse(body.response),
      };
    } catch {
      return {
        error: errorResponse(c, 400, "bad_request", "response must be an interaction response"),
      };
    }
  }
  if (body.type !== "messages") {
    return {
      error: errorResponse(
        c,
        400,
        "bad_request",
        'type must be "messages" or "interaction_response"',
      ),
    };
  }
  let messages: Message[];
  try {
    messages = parseMessages(body.messages);
  } catch {
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
  if (message.role !== "user") {
    return {
      error: errorResponse(c, 400, "bad_request", "The final message must be user-authored"),
    };
  }

  return { type: "messages", messages };
}

function parseRunRequestOptions(
  c: Context,
  body: Record<string, unknown>,
  request: AgentRunRequest,
): AgentRunRequest | { error: Response } {
  if (request.type === "messages" && "sessionId" in body) {
    if (typeof body.sessionId !== "string" || body.sessionId.trim().length === 0) {
      return { error: errorResponse(c, 400, "bad_request", "sessionId must be a string") };
    }
    if (request.messages.length !== 1 || request.messages[0]?.role !== "user") {
      return {
        error: errorResponse(c, 400, "bad_request", "sessionId requires exactly one user message"),
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

  if (request.type === "messages" && "maxTurns" in body) {
    if (!isNonNegativeInteger(body.maxTurns)) {
      return {
        error: errorResponse(c, 400, "bad_request", "maxTurns must be a non-negative integer"),
      };
    }
    request.maxTurns = body.maxTurns;
  }

  if (request.type === "messages" && "toolConcurrency" in body) {
    if (!isPositiveInteger(body.toolConcurrency)) {
      return {
        error: errorResponse(c, 400, "bad_request", "toolConcurrency must be a positive integer"),
      };
    }
    request.toolConcurrency = body.toolConcurrency;
  }

  if (request.type === "messages" && "model" in body) {
    if (
      isObject(body.model) &&
      typeof body.model.providerId === "string" &&
      typeof body.model.modelId === "string"
    ) {
      request.model = {
        providerId: body.model.providerId,
        modelId: body.model.modelId,
      };
    } else {
      return {
        error: errorResponse(
          c,
          400,
          "bad_request",
          "model must be a { providerId, modelId } object",
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

function toolResultOutputText(output: ToolResultOutput): string {
  if (output.type === "text" || output.type === "error-text") return output.value;
  if (output.type === "json" || output.type === "error-json") return formatJson(output.value);
  if (output.type === "execution-denied") return output.reason ?? "Execution denied";
  return output.value
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[file:${part.mediaType}${part.filename === undefined ? "" : `:${part.filename}`}]`,
    )
    .join("\n");
}
