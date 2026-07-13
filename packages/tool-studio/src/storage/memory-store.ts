import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import type { MemoryAppendInput, MemoryContext, MemoryErrorInput } from "@anvia/core/memory";
import { renumberTranscript, transcriptFromMessages } from "../runtime/transcript";
import { isJsonObject, isJsonValue } from "../runtime/type-guards";
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
      id: input.id,
      agentId: input.agentId,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
      runs: [],
      logs: [],
    };
    if (input.title !== undefined) session.title = input.title;
    if (input.metadata !== undefined) session.metadata = input.metadata;
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
    const entry: StudioSessionLogEntry = {
      id: globalThis.crypto.randomUUID(),
      sessionId: input.sessionId,
      sequence: logs.length,
      timestamp: new Date().toISOString(),
      level: input.level,
      category: input.category,
      event: input.event,
      message: input.message,
    };
    if (input.runId !== undefined) entry.runId = input.runId;
    if (input.metadata !== undefined) entry.metadata = input.metadata;
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
    const entry: StudioPipelineLogEntry = {
      id: globalThis.crypto.randomUUID(),
      pipelineId: input.pipelineId,
      sequence: logs.length,
      timestamp: new Date().toISOString(),
      level: input.level,
      category: input.category,
      event: input.event,
      message: input.message,
    };
    if (input.runId !== undefined) entry.runId = input.runId;
    if (input.metadata !== undefined) entry.metadata = input.metadata;
    this.pipelineLogs.set(input.pipelineId, [...logs, entry]);
    return entry;
  }

  listPipelineLogs(options: StudioPipelineLogListOptions): StudioPipelineLogEntry[] {
    return (this.pipelineLogs.get(options.pipelineId) ?? [])
      .filter((log) => options.after === undefined || log.sequence > options.after)
      .slice(0, options.limit);
  }

  savePipelineRun(input: StudioPipelineRunSaveInput): StudioPipelineRunRecord {
    const record: StudioPipelineRunRecord = {
      runId: input.runId,
      pipelineId: input.pipelineId,
      status: input.status,
      input: input.input,
      startedAt: input.startedAt,
    };
    if (input.output !== undefined) record.output = input.output;
    if (input.error !== undefined) record.error = input.error;
    if (input.metadata !== undefined) record.metadata = input.metadata;
    if (input.endedAt !== undefined) record.endedAt = input.endedAt;
    if (input.durationMs !== undefined) record.durationMs = input.durationMs;
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
  const summary: StudioSessionSummary = {
    id: session.id,
    agentId: session.agentId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
  if (session.title !== undefined) summary.title = session.title;
  if (session.metadata !== undefined) summary.metadata = session.metadata;
  return summary;
}

function materializeSession(session: MemorySessionRecord): StudioSession {
  return {
    ...sessionSummary(session),
    messages: [...session.messages],
    transcript: renumberTranscript(session.runs.flatMap((run) => run.transcript)),
  };
}

function traceSummary(trace: StudioTrace): StudioTraceSummary {
  const summary: StudioTraceSummary = {
    id: trace.id,
    sessionId: trace.sessionId,
    status: trace.status,
    startedAt: trace.startedAt,
    observationCount: trace.observations.length,
  };
  if (trace.name !== undefined) summary.name = trace.name;
  if (trace.endedAt !== undefined) summary.endedAt = trace.endedAt;
  if (trace.durationMs !== undefined) summary.durationMs = trace.durationMs;
  if (trace.output !== undefined) summary.output = trace.output;
  if (trace.error !== undefined) summary.error = trace.error;
  if (trace.usage !== undefined) summary.usage = trace.usage;
  if (trace.metadata !== undefined) summary.metadata = trace.metadata;
  return summary;
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
