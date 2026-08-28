import type { JsonObject, JsonValue, Message } from "@anvia/core/completion";
import type {
  MemoryAppendOptions,
  MemoryCompactionCapability,
  MemoryCompactionMessage,
  MemoryCompactionReplacePrefixOptions,
  MemoryErrorOptions,
  MemoryScope,
} from "@anvia/core/memory";
import { traceSummary } from "../runtime/trace-summary";
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
  compactionState?: StudioCompactionState | undefined;
  storeRevision: number;
  runs: Array<StudioSessionRunTranscriptInput & { createdAt: string; updatedAt: string }>;
  logs: StudioSessionLogEntry[];
};

type StudioCompactionState = {
  generation: number;
  summary: MemoryCompactionMessage;
  summarizedThroughPosition: number;
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
  readonly compaction: MemoryCompactionCapability = {
    snapshot: ({ scope }) => {
      const session = this.sessions.get(scope.sessionId);
      const messages = session?.messages ?? [];
      return Promise.resolve({
        revision: String(session?.storeRevision ?? 0),
        messages: projectedMessages(messages, session?.compactionState),
      });
    },
    replacePrefix: (options) => this.replaceCompactionPrefix(options),
  };
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
      storeRevision: 0,
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

  load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    return Promise.resolve(cloneMessages(this.sessions.get(scope.sessionId)?.messages ?? []));
  }

  append(input: MemoryAppendOptions): Promise<void> {
    const session = this.sessions.get(input.scope.sessionId);
    if (session !== undefined) {
      session.messages.push(...cloneMessages(input.messages));
      session.storeRevision += 1;
      session.messageCount = session.messages.length;
      session.updatedAt = new Date().toISOString();
    }
    return Promise.resolve();
  }

  clear({ scope }: { scope: MemoryScope }): Promise<void> {
    const session = this.sessions.get(scope.sessionId);
    if (session !== undefined) {
      session.messages = [];
      delete session.compactionState;
      session.storeRevision += 1;
      session.runs = [];
      session.messageCount = 0;
      session.updatedAt = new Date().toISOString();
    }
    return Promise.resolve();
  }

  async recordError(input: MemoryErrorOptions): Promise<void> {
    await this.saveSessionRunTranscript({
      id: input.scope.sessionId,
      runId: studioRunId(input.scope) ?? input.runId,
      transcript: transcriptFromMessages(input.messages),
      status: "error",
      error: serializeJsonError(input.error),
    });
  }

  private replaceCompactionPrefix(
    input: MemoryCompactionReplacePrefixOptions,
  ): Promise<{ status: "committed" | "conflict" }> {
    if (!Number.isSafeInteger(input.messageCount) || input.messageCount < 1) {
      throw new RangeError("messageCount must be a positive integer.");
    }
    const session = this.sessions.get(input.scope.sessionId);
    if (session === undefined || String(session.storeRevision) !== input.revision) {
      return Promise.resolve({ status: "conflict" });
    }
    const physicalPrefixCount =
      input.messageCount - (session.compactionState === undefined ? 0 : 1);
    const activeMessageCount =
      session.messages.length - (session.compactionState?.summarizedThroughPosition ?? -1) - 1;
    if (physicalPrefixCount < 0 || physicalPrefixCount > activeMessageCount) {
      return Promise.resolve({ status: "conflict" });
    }
    session.compactionState = {
      generation: (session.compactionState?.generation ?? 0) + 1,
      summary: structuredClone(input.replacement),
      summarizedThroughPosition:
        (session.compactionState?.summarizedThroughPosition ?? -1) + physicalPrefixCount,
    };
    session.storeRevision += 1;
    session.updatedAt = new Date().toISOString();
    return Promise.resolve({ status: "committed" });
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
    messages: cloneMessages(session.messages),
    transcript: renumberTranscript(session.runs.flatMap((run) => run.transcript)),
  };
}

function cloneMessages(messages: readonly Message[]): Message[] {
  return structuredClone([...messages]);
}

function traceAgentId(trace: StudioTrace): string | undefined {
  const nestedMetadata = trace.metadata?.metadata;
  return isJsonObject(nestedMetadata) && typeof nestedMetadata.agentId === "string"
    ? nestedMetadata.agentId
    : undefined;
}

function studioRunId(scope: MemoryScope): string | undefined {
  const value = scope.metadata?.studioRunId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectedMessages(
  messages: Message[],
  state: StudioCompactionState | undefined,
): Message[] {
  if (state === undefined) return cloneMessages(messages);
  return [
    structuredClone(state.summary),
    ...cloneMessages(messages.slice(state.summarizedThroughPosition + 1)),
  ];
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
