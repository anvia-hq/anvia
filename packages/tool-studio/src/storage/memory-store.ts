import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { compact } from "../runtime/compact";
import { renumberTranscript, transcriptFromMessages } from "../runtime/transcript";
import type {
  StudioPipelineLogAppendInput,
  StudioPipelineLogEntry,
  StudioPipelineLogListOptions,
  StudioPipelineLogStore,
  StudioPipelineRunListOptions,
  StudioPipelineRunRecord,
  StudioPipelineRunSaveInput,
  StudioPipelineRunStore,
  StudioSession,
  StudioSessionCreateInput,
  StudioSessionListOptions,
  StudioSessionLogAppendInput,
  StudioSessionLogEntry,
  StudioSessionLogListOptions,
  StudioSessionRunTranscriptInput,
  StudioSessionStore,
  StudioSessionSummary,
  StudioSessionTraceListOptions,
  StudioTrace,
  StudioTraceListOptions,
  StudioTraceStore,
  StudioTraceSummary,
} from "../types";

type MemorySessionRecord = StudioSessionSummary & {
  messages: Message[];
  runs: Array<StudioSessionRunTranscriptInput & { createdAt: string; updatedAt: string }>;
  logs: StudioSessionLogEntry[];
};

export function createInMemoryStudioStore(): StudioSessionStore &
  StudioTraceStore &
  StudioPipelineLogStore &
  StudioPipelineRunStore {
  return new InMemoryStudioStore();
}

class InMemoryStudioStore
  implements StudioSessionStore, StudioTraceStore, StudioPipelineLogStore, StudioPipelineRunStore
{
  readonly kind = "memory";
  private readonly sessions = new Map<string, MemorySessionRecord>();
  private readonly traces = new Map<string, StudioTrace>();
  private readonly pipelineLogs = new Map<string, StudioPipelineLogEntry[]>();
  private readonly pipelineRuns = new Map<string, StudioPipelineRunRecord>();

  listSessions(options: StudioSessionListOptions): StudioSessionSummary[] {
    return [...this.sessions.values()]
      .filter((session) => options.agentId === undefined || session.agentId === options.agentId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, options.limit)
      .map(sessionSummary);
  }

  createSession(input: StudioSessionCreateInput): StudioSessionSummary {
    const now = new Date().toISOString();
    const session: MemorySessionRecord = {
      ...compact({
        id: input.id,
        agentId: input.agentId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        metadata: input.metadata,
      }),
      messages: [],
      runs: [],
      logs: [],
    };
    this.sessions.set(input.id, session);
    return sessionSummary(session);
  }

  getSession(id: string): StudioSession | undefined {
    const session = this.sessions.get(id);
    return session === undefined ? undefined : materializeSession(session);
  }

  updateSessionMetadata(id: string, metadata: JsonObject | undefined): StudioSession | undefined {
    const session = this.sessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    if (metadata === undefined) {
      delete session.metadata;
    } else {
      session.metadata = metadata;
    }
    session.updatedAt = new Date().toISOString();
    return materializeSession(session);
  }

  load(context: MemoryContext): Promise<Message[]> {
    return Promise.resolve(this.sessions.get(context.sessionId)?.messages ?? []);
  }

  append(input: MemoryAppendInput): Promise<void> {
    const session = this.sessions.get(input.context.sessionId);
    if (session !== undefined) {
      session.messages.push(...input.messages);
      session.messageCount = session.messages.length;
      session.updatedAt = new Date().toISOString();
    }
    return Promise.resolve();
  }

  clear(context: MemoryContext): Promise<void> {
    const session = this.sessions.get(context.sessionId);
    if (session !== undefined) {
      session.messages = [];
      session.runs = [];
      session.messageCount = 0;
      session.updatedAt = new Date().toISOString();
    }
    return Promise.resolve();
  }

  async recordError(input: MemoryErrorInput): Promise<void> {
    await this.saveSessionRunTranscript({
      id: input.context.sessionId,
      runId: studioRunId(input.context) ?? input.runId,
      transcript: transcriptFromMessages(input.messages),
      status: "error",
      error: serializeJsonError(input.error),
    });
  }

  saveSessionRunTranscript(input: StudioSessionRunTranscriptInput): StudioSession | undefined {
    const session = this.sessions.get(input.id);
    if (session === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    const existingIndex = session.runs.findIndex((run) => run.runId === input.runId);
    const run = {
      ...input,
      transcript: renumberTranscript(input.transcript),
      createdAt: existingIndex === -1 ? now : (session.runs[existingIndex]?.createdAt ?? now),
      updatedAt: now,
    };
    if (existingIndex === -1) {
      session.runs.push(run);
    } else {
      session.runs[existingIndex] = run;
    }
    session.updatedAt = now;
    return materializeSession(session);
  }

  appendSessionLog(input: StudioSessionLogAppendInput): StudioSessionLogEntry {
    const session = this.sessions.get(input.sessionId);
    const logs = session?.logs ?? [];
    const entry: StudioSessionLogEntry = compact({
      id: globalThis.crypto.randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: logs.length,
      timestamp: new Date().toISOString(),
      level: input.level,
      category: input.category,
      event: input.event,
      message: input.message,
      metadata: input.metadata,
    }) as StudioSessionLogEntry;
    if (session !== undefined) {
      session.logs.push(entry);
      session.updatedAt = entry.timestamp;
    }
    return entry;
  }

  listSessionLogs(options: StudioSessionLogListOptions): StudioSessionLogEntry[] {
    return (this.sessions.get(options.sessionId)?.logs ?? [])
      .filter((log) => options.after === undefined || log.sequence > options.after)
      .slice(0, options.limit);
  }

  deleteSession(id: string): boolean {
    for (const trace of this.traces.values()) {
      if (trace.sessionId === id) {
        this.traces.delete(trace.id);
      }
    }
    return this.sessions.delete(id);
  }

  listTraces(options: StudioTraceListOptions): StudioTraceSummary[] {
    return [...this.traces.values()]
      .filter((trace) => options.sessionId === undefined || trace.sessionId === options.sessionId)
      .filter((trace) => options.status === undefined || trace.status === options.status)
      .filter((trace) => options.agentId === undefined || traceAgentId(trace) === options.agentId)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
      .slice(0, options.limit)
      .map(traceSummary);
  }

  listSessionTraces(options: StudioSessionTraceListOptions): StudioTraceSummary[] {
    return this.listTraces({ sessionId: options.sessionId, limit: options.limit });
  }

  getTrace(id: string): StudioTrace | undefined {
    return this.traces.get(id);
  }

  saveTrace(trace: StudioTrace): StudioTrace {
    this.traces.set(trace.id, trace);
    return trace;
  }

  appendPipelineLog(input: StudioPipelineLogAppendInput): StudioPipelineLogEntry {
    const logs = this.pipelineLogs.get(input.pipelineId) ?? [];
    const entry: StudioPipelineLogEntry = compact({
      id: globalThis.crypto.randomUUID(),
      pipelineId: input.pipelineId,
      runId: input.runId,
      sequence: logs.length,
      timestamp: new Date().toISOString(),
      level: input.level,
      category: input.category,
      event: input.event,
      message: input.message,
      metadata: input.metadata,
    }) as StudioPipelineLogEntry;
    this.pipelineLogs.set(input.pipelineId, [...logs, entry]);
    return entry;
  }

  listPipelineLogs(options: StudioPipelineLogListOptions): StudioPipelineLogEntry[] {
    return (this.pipelineLogs.get(options.pipelineId) ?? [])
      .filter((log) => options.after === undefined || log.sequence > options.after)
      .slice(0, options.limit);
  }

  savePipelineRun(input: StudioPipelineRunSaveInput): StudioPipelineRunRecord {
    const record: StudioPipelineRunRecord = compact({
      runId: input.runId,
      pipelineId: input.pipelineId,
      status: input.status,
      input: input.input,
      output: input.output,
      error: input.error,
      metadata: input.metadata,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMs: input.durationMs,
    }) as StudioPipelineRunRecord;
    this.pipelineRuns.set(input.runId, record);
    return record;
  }

  getPipelineRun(options: {
    pipelineId: string;
    runId: string;
  }): StudioPipelineRunRecord | undefined {
    const run = this.pipelineRuns.get(options.runId);
    return run?.pipelineId === options.pipelineId ? run : undefined;
  }

  listPipelineRuns(options: StudioPipelineRunListOptions): StudioPipelineRunRecord[] {
    return [...this.pipelineRuns.values()]
      .filter((run) => run.pipelineId === options.pipelineId)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
      .slice(0, options.limit);
  }
}

function sessionSummary(session: MemorySessionRecord): StudioSessionSummary {
  return compact({
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    metadata: session.metadata,
  }) as StudioSessionSummary;
}

function materializeSession(session: MemorySessionRecord): StudioSession {
  return {
    ...sessionSummary(session),
    messages: [...session.messages],
    transcript: renumberTranscript(session.runs.flatMap((run) => run.transcript)),
  };
}

function traceSummary(trace: StudioTrace): StudioTraceSummary {
  return compact({
    id: trace.id,
    sessionId: trace.sessionId,
    name: trace.name,
    status: trace.status,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    output: trace.output,
    error: trace.error,
    usage: trace.usage,
    metadata: trace.metadata,
    observationCount: trace.observations.length,
  }) as StudioTraceSummary;
}

function traceAgentId(trace: StudioTrace): string | undefined {
  const nestedMetadata = trace.metadata?.metadata;
  return isJsonObject(nestedMetadata) && typeof nestedMetadata.agentId === "string"
    ? nestedMetadata.agentId
    : undefined;
}

function studioRunId(context: MemoryContext): string | undefined {
  const value = context.metadata?.studioRunId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function serializeJsonError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return isJsonValue(error) ? error : String(error);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value) && Object.values(value).every(isJsonValue);
}
