import type { JsonObject, JsonValue, Message } from "@anvia/core";
import type {
  AgentRunStreamEvent,
  StudioSession,
  StudioSessionLogAppendInput,
  StudioSessionLogEntry,
  StudioSessionStore,
} from "../types";
import { serializeError } from "./shared";

export async function appendSessionLog(
  store: StudioSessionStore | undefined,
  input: StudioSessionLogAppendInput,
): Promise<StudioSessionLogEntry | undefined> {
  return store?.appendSessionLog?.(input);
}

export async function* streamSessionRunLogs(props: {
  stream: AsyncIterable<AgentRunStreamEvent>;
  store: StudioSessionStore;
  session: StudioSession;
  runId: string;
  startedAt: number;
}): AsyncIterable<AgentRunStreamEvent> {
  yield* emitLog(props.store, runStartedLog(props.session, props.runId));
  yield* emitLog(props.store, memoryLoadedLog(props.session, props.runId));

  try {
    for await (const event of props.stream) {
      for (const input of logsFromStreamEvent({
        event,
        runId: props.runId,
        sessionId: props.session.id,
        startedAt: props.startedAt,
      })) {
        yield* emitLog(props.store, input);
      }
      yield event;
    }
  } catch (error) {
    yield* emitLog(
      props.store,
      runFailedLog(props.session.id, props.runId, error, props.startedAt),
    );
    throw error;
  }
}

export function sessionCreatedLog(
  session: StudioSession | { id: string; agentId: string; title?: string },
): StudioSessionLogAppendInput {
  return {
    sessionId: session.id,
    level: "info",
    category: "session",
    event: "session.created",
    message: "Session created",
    metadata: cleanMetadata({
      agentId: session.agentId,
      hasTitle: session.title !== undefined,
      titleLength: session.title?.length ?? 0,
    }),
  };
}

export function runReceivedLog(props: {
  sessionId: string;
  runId: string;
  agentId: string;
  message: string | Message;
  stream: boolean;
  maxTurns?: number;
  toolConcurrency?: number;
  hasTrace: boolean;
  metadata?: JsonObject;
}): StudioSessionLogAppendInput {
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "info",
    category: "api",
    event: "run.received",
    message: "Run request received",
    metadata: cleanMetadata({
      agentId: props.agentId,
      stream: props.stream,
      message: messageSummary(props.message),
      maxTurns: props.maxTurns,
      toolConcurrency: props.toolConcurrency,
      hasTrace: props.hasTrace,
      metadataKeys: Object.keys(props.metadata ?? {}),
    }),
  };
}

export function runStartedLog(session: StudioSession, runId: string): StudioSessionLogAppendInput {
  return {
    sessionId: session.id,
    runId,
    level: "info",
    category: "run",
    event: "run.started",
    message: "Run started",
    metadata: cleanMetadata({
      agentId: session.agentId,
      existingMessageCount: session.messageCount,
    }),
  };
}

export function memoryLoadedLog(
  session: StudioSession,
  runId: string,
): StudioSessionLogAppendInput {
  return {
    sessionId: session.id,
    runId,
    level: "debug",
    category: "memory",
    event: "memory.loaded",
    message: "Session memory loaded",
    metadata: cleanMetadata({
      messageCount: session.messageCount,
      transcriptEntries: session.transcript.length,
    }),
  };
}

export function runCompletedLog(props: {
  sessionId: string;
  runId: string;
  durationMs: number;
  usage?: unknown;
  output?: string;
  messageCount?: number;
}): StudioSessionLogAppendInput {
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "info",
    category: "run",
    event: "run.completed",
    message: "Run completed",
    metadata: cleanMetadata({
      durationMs: props.durationMs,
      usage: usageSummary(props.usage),
      outputBytes: byteLength(props.output),
      messageCount: props.messageCount,
    }),
  };
}

export function memorySavedLog(props: {
  sessionId: string;
  runId: string;
  messageCount?: number;
}): StudioSessionLogAppendInput {
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "debug",
    category: "memory",
    event: "memory.saved",
    message: "Session memory saved",
    metadata: cleanMetadata({
      messageCount: props.messageCount,
    }),
  };
}

export function runFailedLog(
  sessionId: string,
  runId: string,
  error: unknown,
  startedAt: number,
): StudioSessionLogAppendInput {
  return {
    sessionId,
    runId,
    level: "error",
    category: "run",
    event: "run.failed",
    message: "Run failed",
    metadata: cleanMetadata({
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    }),
  };
}

function logsFromStreamEvent(props: {
  event: AgentRunStreamEvent;
  sessionId: string;
  runId: string;
  startedAt: number;
}): StudioSessionLogAppendInput[] {
  const { event, sessionId, runId } = props;
  if (event.type === "turn_start") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "prompt",
        event: "prompt.prepared",
        message: `Turn ${event.turn} prompt prepared`,
        metadata: cleanMetadata({
          turn: event.turn,
          prompt: messageSummary(event.prompt),
          historyCount: event.history.length,
        }),
      },
    ];
  }
  if (event.type === "tool_call") {
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "tool",
        event: "tool.called",
        message: `Tool ${event.toolCall.function.name} called`,
        metadata: cleanMetadata({
          turn: event.turn,
          toolName: event.toolCall.function.name,
          callId: event.toolCall.callId ?? event.toolCall.id,
          argumentBytes: byteLength(formatUnknown(event.toolCall.function.arguments)),
        }),
      },
    ];
  }
  if (event.type === "tool_result") {
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "tool",
        event: "tool.completed",
        message: `Tool ${event.toolName} completed`,
        metadata: cleanMetadata({
          turn: event.turn,
          toolName: event.toolName,
          callId: event.toolCallId,
          internalCallId: event.internalCallId,
          argumentBytes: byteLength(event.args),
          resultBytes: byteLength(event.result),
        }),
      },
    ];
  }
  if (event.type === "turn_end") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "model",
        event: "model.turn.completed",
        message: `Model turn ${event.turn} completed`,
        metadata: cleanMetadata({
          turn: event.turn,
          contentCount: event.response.choice.length,
          usage: usageSummary(event.response.usage),
        }),
      },
    ];
  }
  if (event.type === "final") {
    return [
      runCompletedLog({
        sessionId,
        runId,
        durationMs: Date.now() - props.startedAt,
        usage: event.usage,
        output: event.output,
        messageCount: event.messages.length,
      }),
      memorySavedLog({ sessionId, runId, messageCount: event.messages.length }),
    ];
  }
  if (event.type === "error") {
    return [runFailedLog(sessionId, runId, event.error, props.startedAt)];
  }
  if (event.type === "tool_approval_request") {
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "approval",
        event: "approval.requested",
        message: `Approval requested for ${event.approval.toolName}`,
        metadata: cleanMetadata({
          approvalId: event.approval.id,
          toolName: event.approval.toolName,
          callId: event.approval.callId,
          status: event.approval.status,
          hasReason: event.approval.reason !== undefined,
          argumentBytes: byteLength(event.approval.args),
        }),
      },
    ];
  }
  if (event.type === "tool_approval_result") {
    return [
      {
        sessionId,
        runId,
        level: event.approval.status === "approved" ? "info" : "warn",
        category: "approval",
        event: "approval.resolved",
        message: `Approval ${event.approval.status} for ${event.approval.toolName}`,
        metadata: cleanMetadata({
          approvalId: event.approval.id,
          toolName: event.approval.toolName,
          callId: event.approval.callId,
          status: event.approval.status,
          hasReason: event.approval.reason !== undefined,
        }),
      },
    ];
  }
  if (event.type === "tool_question_request") {
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "question",
        event: "question.requested",
        message: `Question requested by ${event.question.toolName}`,
        metadata: cleanMetadata({
          questionId: event.question.id,
          toolName: event.question.toolName,
          callId: event.question.callId,
          status: event.question.status,
          questionCount: event.question.questions.length,
          argumentBytes: byteLength(event.question.args),
        }),
      },
    ];
  }
  if (event.type === "tool_question_result") {
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "question",
        event: "question.answered",
        message: `Question answered for ${event.question.toolName}`,
        metadata: cleanMetadata({
          questionId: event.question.id,
          toolName: event.question.toolName,
          callId: event.question.callId,
          status: event.question.status,
          answerCount: event.question.answers?.length ?? 0,
        }),
      },
    ];
  }
  if (event.type === "agent_tool_event") {
    return childAgentLog(event, sessionId, runId);
  }
  return [];
}

async function* emitLog(
  store: StudioSessionStore,
  input: StudioSessionLogAppendInput,
): AsyncIterable<AgentRunStreamEvent> {
  const log = await appendSessionLog(store, input);
  if (log !== undefined) {
    yield { type: "session_log", log };
  }
}

function childAgentLog(
  event: Extract<AgentRunStreamEvent, { type: "agent_tool_event" }>,
  sessionId: string,
  runId: string,
): StudioSessionLogAppendInput[] {
  const child = event.event;
  if (child.type === "tool_call") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "tool",
        event: "child_tool.called",
        message: `Child agent ${event.agentName ?? event.agentId} called ${child.toolCall.function.name}`,
        metadata: cleanMetadata({
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          turn: event.turn,
          childTurn: child.turn,
          toolName: child.toolCall.function.name,
          callId: child.toolCall.callId ?? child.toolCall.id,
          argumentBytes: byteLength(formatUnknown(child.toolCall.function.arguments)),
        }),
      },
    ];
  }
  if (child.type === "tool_result") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "tool",
        event: "child_tool.completed",
        message: `Child agent ${event.agentName ?? event.agentId} completed ${child.toolName}`,
        metadata: cleanMetadata({
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          turn: event.turn,
          childTurn: child.turn,
          toolName: child.toolName,
          callId: child.toolCallId,
          resultBytes: byteLength(child.result),
        }),
      },
    ];
  }
  if (child.type === "turn_start") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "run",
        event: "child_agent.turn_started",
        message: `Child agent ${event.agentName ?? event.agentId} turn ${child.turn} started`,
        metadata: cleanMetadata({
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          childTurn: child.turn,
          historyCount: child.history.length,
        }),
      },
    ];
  }
  if (child.type === "final") {
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "run",
        event: "child_agent.completed",
        message: `Child agent ${event.agentName ?? event.agentId} completed`,
        metadata: cleanMetadata({
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          usage: usageSummary(child.usage),
          outputBytes: byteLength(child.output),
          messageCount: child.messages.length,
        }),
      },
    ];
  }
  if (child.type === "error") {
    return [
      {
        sessionId,
        runId,
        level: "error",
        category: "run",
        event: "child_agent.failed",
        message: `Child agent ${event.agentName ?? event.agentId} failed`,
        metadata: cleanMetadata({
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          error: serializeError(child.error),
        }),
      },
    ];
  }
  return [];
}

function messageSummary(message: string | Message): JsonObject {
  if (typeof message === "string") {
    return {
      role: "user",
      contentKind: "text",
      byteLength: byteLength(message),
    };
  }
  return {
    role: message.role,
    contentKind: Array.isArray(message.content) ? "parts" : "text",
    partCount: Array.isArray(message.content) ? message.content.length : 1,
    byteLength: byteLength(formatUnknown(message.content)),
  };
}

function usageSummary(value: unknown): JsonObject | undefined {
  if (value === undefined || value === null || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return cleanMetadata({
    inputTokens: numericValue(record.inputTokens),
    outputTokens: numericValue(record.outputTokens),
    totalTokens: numericValue(record.totalTokens),
    cachedInputTokens: numericValue(record.cachedInputTokens),
    cacheCreationInputTokens: numericValue(record.cacheCreationInputTokens),
  });
}

function cleanMetadata(value: Record<string, unknown>): JsonObject {
  const cleaned: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    const jsonValue = cleanJsonValue(item);
    if (jsonValue !== undefined) {
      cleaned[key] = jsonValue;
    }
  }
  return cleaned;
}

function cleanJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    return cleanMetadata(value as Record<string, unknown>);
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function byteLength(value: string | undefined): number {
  return value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
