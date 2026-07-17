import type { JsonObject, Message } from "@anvia/core/completion";
import type {
  AgentRunStreamEvent,
  StudioSession,
  StudioSessionLogAppendInput,
  StudioSessionLogEntry,
  StudioSessionStore,
} from "../types";
import { serializeError } from "./errors";
import { formatUnknown } from "./json";

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
    metadata: {
      agentId: session.agentId,
      hasTitle: session.title !== undefined,
      titleLength: session.title?.length ?? 0,
    },
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
  const metadata: JsonObject = {
    agentId: props.agentId,
    stream: props.stream,
    message: messageSummary(props.message),
    hasTrace: props.hasTrace,
    metadataKeys: Object.keys(props.metadata ?? {}),
  };
  if (props.maxTurns !== undefined) metadata.maxTurns = props.maxTurns;
  if (props.toolConcurrency !== undefined) metadata.toolConcurrency = props.toolConcurrency;
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "info",
    category: "api",
    event: "run.received",
    message: "Run request received",
    metadata,
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
    metadata: {
      agentId: session.agentId,
      existingMessageCount: session.messageCount,
    },
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
    metadata: {
      messageCount: session.messageCount,
      transcriptEntries: session.transcript.length,
    },
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
  const metadata: JsonObject = {
    durationMs: props.durationMs,
    outputBytes: byteLength(props.output),
  };
  const usage = usageSummary(props.usage);
  if (usage !== undefined) metadata.usage = usage;
  if (props.messageCount !== undefined) metadata.messageCount = props.messageCount;
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "info",
    category: "run",
    event: "run.completed",
    message: "Run completed",
    metadata,
  };
}

export function runCancelledLog(
  sessionId: string,
  runId: string,
  startedAt: number,
): StudioSessionLogAppendInput {
  return {
    sessionId,
    runId,
    level: "info",
    category: "run",
    event: "run.cancelled",
    message: "Run cancelled",
    metadata: {
      durationMs: Date.now() - startedAt,
    },
  };
}

export function memorySavedLog(props: {
  sessionId: string;
  runId: string;
  messageCount?: number;
}): StudioSessionLogAppendInput {
  const metadata: JsonObject = {};
  if (props.messageCount !== undefined) metadata.messageCount = props.messageCount;
  return {
    sessionId: props.sessionId,
    runId: props.runId,
    level: "debug",
    category: "memory",
    event: "memory.saved",
    message: "Session memory saved",
    metadata,
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
    metadata: {
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    },
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
        metadata: {
          turn: event.turn,
          prompt: messageSummary(event.prompt),
          historyCount: event.history.length,
        },
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
        metadata: {
          turn: event.turn,
          toolName: event.toolCall.function.name,
          callId: event.toolCall.callId ?? event.toolCall.id,
          argumentBytes: byteLength(formatUnknown(event.toolCall.function.arguments)),
        },
      },
    ];
  }
  if (event.type === "tool_result") {
    const metadata: JsonObject = {
      turn: event.turn,
      toolName: event.toolName,
      argumentBytes: byteLength(event.args),
      resultBytes: byteLength(event.result),
    };
    if (event.toolCallId !== undefined) metadata.callId = event.toolCallId;
    if (event.internalCallId !== undefined) metadata.internalCallId = event.internalCallId;
    if (event.structuredResult !== undefined) {
      metadata.structuredResultBytes = byteLength(JSON.stringify(event.structuredResult));
    }
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "tool",
        event: "tool.completed",
        message: `Tool ${event.toolName} completed`,
        metadata,
      },
    ];
  }
  if (event.type === "turn_end") {
    const metadata: JsonObject = {
      turn: event.turn,
      contentCount: event.response.choice.length,
    };
    const usage = usageSummary(event.response.usage);
    if (usage !== undefined) metadata.usage = usage;
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "model",
        event: "model.turn.completed",
        message: `Model turn ${event.turn} completed`,
        metadata,
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
    const metadata: JsonObject = {
      approvalId: event.approval.id,
      toolName: event.approval.toolName,
      status: event.approval.status,
      hasReason: event.approval.reason !== undefined,
      argumentBytes: byteLength(event.approval.args),
    };
    if (event.approval.callId !== undefined) metadata.callId = event.approval.callId;
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "approval",
        event: "approval.requested",
        message: `Approval requested for ${event.approval.toolName}`,
        metadata,
      },
    ];
  }
  if (event.type === "tool_approval_result") {
    const metadata: JsonObject = {
      approvalId: event.approval.id,
      toolName: event.approval.toolName,
      status: event.approval.status,
      hasReason: event.approval.reason !== undefined,
    };
    if (event.approval.callId !== undefined) metadata.callId = event.approval.callId;
    return [
      {
        sessionId,
        runId,
        level: event.approval.status === "approved" ? "info" : "warn",
        category: "approval",
        event: "approval.resolved",
        message: `Approval ${event.approval.status} for ${event.approval.toolName}`,
        metadata,
      },
    ];
  }
  if (event.type === "tool_question_request") {
    const metadata: JsonObject = {
      questionId: event.question.id,
      toolName: event.question.toolName,
      status: event.question.status,
      questionCount: event.question.questions.length,
      argumentBytes: byteLength(event.question.args),
    };
    if (event.question.callId !== undefined) metadata.callId = event.question.callId;
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "question",
        event: "question.requested",
        message: `Question requested by ${event.question.toolName}`,
        metadata,
      },
    ];
  }
  if (event.type === "tool_question_result") {
    const cancelled = event.question.status === "cancelled";
    const metadata: JsonObject = {
      questionId: event.question.id,
      toolName: event.question.toolName,
      status: event.question.status,
      questionCount: event.question.questions.length,
      argumentBytes: byteLength(event.question.args),
      answerCount: event.question.answers?.length ?? 0,
    };
    if (event.question.callId !== undefined) metadata.callId = event.question.callId;
    return [
      {
        sessionId,
        runId,
        level: "info",
        category: "question",
        event: cancelled ? "question.cancelled" : "question.answered",
        message: cancelled
          ? `Question cancelled for ${event.question.toolName}`
          : `Question answered for ${event.question.toolName}`,
        metadata,
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
        metadata: {
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          turn: event.turn,
          childTurn: child.turn,
          toolName: child.toolCall.function.name,
          callId: child.toolCall.callId ?? child.toolCall.id,
          argumentBytes: byteLength(formatUnknown(child.toolCall.function.arguments)),
        },
      },
    ];
  }
  if (child.type === "tool_result") {
    const metadata: JsonObject = {
      parentToolName: event.toolName,
      agentId: event.agentId,
      hasAgentName: event.agentName !== undefined,
      turn: event.turn,
      childTurn: child.turn,
      toolName: child.toolName,
      resultBytes: byteLength(child.result),
    };
    if (child.toolCallId !== undefined) metadata.callId = child.toolCallId;
    if (child.structuredResult !== undefined) {
      metadata.structuredResultBytes = byteLength(JSON.stringify(child.structuredResult));
    }
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "tool",
        event: "child_tool.completed",
        message: `Child agent ${event.agentName ?? event.agentId} completed ${child.toolName}`,
        metadata,
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
        metadata: {
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          childTurn: child.turn,
          historyCount: child.history.length,
        },
      },
    ];
  }
  if (child.type === "final") {
    const metadata: JsonObject = {
      parentToolName: event.toolName,
      agentId: event.agentId,
      hasAgentName: event.agentName !== undefined,
      outputBytes: byteLength(child.output),
      messageCount: child.messages.length,
    };
    const usage = usageSummary(child.usage);
    if (usage !== undefined) metadata.usage = usage;
    return [
      {
        sessionId,
        runId,
        level: "debug",
        category: "run",
        event: "child_agent.completed",
        message: `Child agent ${event.agentName ?? event.agentId} completed`,
        metadata,
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
        metadata: {
          parentToolName: event.toolName,
          agentId: event.agentId,
          hasAgentName: event.agentName !== undefined,
          error: serializeError(child.error),
        },
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
  const summary: JsonObject = {};
  const inputTokens = numericValue(record.inputTokens);
  const outputTokens = numericValue(record.outputTokens);
  const totalTokens = numericValue(record.totalTokens);
  const cachedInputTokens = numericValue(record.cachedInputTokens);
  const cacheCreationInputTokens = numericValue(record.cacheCreationInputTokens);
  if (inputTokens !== undefined) summary.inputTokens = inputTokens;
  if (outputTokens !== undefined) summary.outputTokens = outputTokens;
  if (totalTokens !== undefined) summary.totalTokens = totalTokens;
  if (cachedInputTokens !== undefined) summary.cachedInputTokens = cachedInputTokens;
  if (cacheCreationInputTokens !== undefined) {
    summary.cacheCreationInputTokens = cacheCreationInputTokens;
  }
  return summary;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function byteLength(value: string | undefined): number {
  return value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
}
