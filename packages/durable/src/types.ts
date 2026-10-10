import type { DurableLimits } from "./limits.js";
import type { DurableMetrics } from "./metrics.js";
import type {
  DurableGraphRecord,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";
import type { RegisteredTask, TaskListOptions, TaskPage, TaskTransaction } from "./tasks/types.js";
import type { Agent, AgentInput, AgentOutcome, AgentPrompt } from "@anvia/core/agent";
import type { JsonValue, Message, Usage } from "@anvia/core/completion";
import type { MemoryCompactor, MemoryTokenCounter } from "@anvia/core/memory";

/** Serializable policy captured when a run is submitted. */
export type DurableCompactionPolicy = {
  trigger: { afterTokens: number };
  /** User-led turns and in-run tool rounds to retain. Both default to one. */
  retention?: { recentTurns?: number | undefined; recentToolTurns?: number | undefined };
};

/** Compacts completed session history and tool rounds in the model-facing context. */
export type DurableCompactionOptions = DurableCompactionPolicy & {
  compactor: MemoryCompactor;
  tokenCounter?: MemoryTokenCounter;
};

/** Summary projection; the covered canonical messages remain in run.history. */
export type DurableContextCheckpoint = {
  summary: string;
  compactedMessageCount: number;
};

export type ToolRecovery = "safe" | "idempotent" | "manual";

/** Opt-in retries for model/compactor errors; observer and journal failures are excluded. */
export type DurableModelRetry = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
};

export type DurableAgentRegistration = {
  agent: Agent<unknown>;
  /** Bump whenever code, model, tools, schemas, or instructions change incompatibly. */
  version: string;
  /** Use agent.stream() and persist normalized generation deltas. Defaults to false. */
  stream?: boolean;
  /** Unlisted tools require reconciliation if interrupted after their intent was committed. */
  toolRecovery?: Readonly<Record<string, ToolRecovery>>;
  modelRetry?: DurableModelRetry;
  /** Bump registration.version when the compactor or token counter changes. */
  compaction?: DurableCompactionOptions;
};

export type DurableRunStatus =
  | "queued"
  | "retry_wait"
  | "pending"
  | "running"
  | "waiting"
  | "needs_attention"
  | "completed"
  | "failed"
  | "cancelled";

export type DurableSubmission = {
  agentId: string;
  sessionId: string;
  requestId: string;
  /** Text or a structured user message, including image/file content. */
  prompt: AgentPrompt;
};

export type DurableRunRecord = DurableSubmission & {
  id: string;
  version: string;
  status: DurableRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  graphId?: string;
  taskId?: string;
  dependencies?: string[];
  epoch: number;
  input: AgentInput;
  modelTurns: number;
  maxModelTurns: number;
  usage: Usage;
  /** Canonical history before this submission, retained across interaction continuations. */
  history: Message[];
  compaction?: DurableCompactionPolicy;
  contextCheckpoint?: DurableContextCheckpoint;
  /** Freezes even a skipped compaction decision across retries. */
  contextPrepared?: boolean;
  /** Captured on new submissions; legacy in-flight runs retain their original request sequence. */
  loopCompaction?: boolean;
  outcome?: AgentOutcome<unknown>;
  error?: string;
  /** A turn limit is a failed session, with recoverable partial work for a goal controller. */
  exhaustion?: { reason: "max_turns"; messages: Message[] };
  blockedOperation?: string;
  modelRetry?: DurableModelRetry;
  nextAttemptAt?: string;
  /** Captured at submission; older records continue using generate(). */
  stream?: boolean;
  responses: Record<string, JsonValue>;
};

export type DurableOperation = {
  /** SQLite snapshot histories are immutable linked-log references; use operationRequest(). */
  historyEncoding?: "linked-v1" | undefined;
  key: string;
  kind: "model" | "tool" | "effect" | "compaction" | "context";
  input: JsonValue;
  status: "started" | "completed";
  recovery: ToolRecovery;
  result?: JsonValue | undefined;
  /** Persisted before each completion attempt, including interrupted attempts; reset by explicit retry(). */
  attempts?: number | undefined;
  /** Unique streaming attempt identity, retained even when retry() resets the attempt budget. */
  attemptId?: string | undefined;
};

export type DurableListOptions = {
  sessionId?: string | undefined;
  agentId?: string | undefined;
  status?: DurableRunStatus | undefined;
  /** Exclusive insertion cursor, unrelated to progress-event cursors. */
  after?: number | undefined;
  limit?: number | undefined;
};

export type DurableRunSummary = Pick<
  DurableRunRecord,
  | "id"
  | "agentId"
  | "sessionId"
  | "requestId"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "error"
  | "blockedOperation"
  | "nextAttemptAt"
>;

export type DurableRunPage = { runs: DurableRunSummary[]; nextCursor?: number };

export type DurableSubmitOptions = {
  /** Queue behind unfinished work in the session instead of rejecting the submission. */
  enqueue?: boolean;
};

export type DurableEvent = {
  sequence: number;
  runId: string;
  createdAt: string;
  type:
    | "submitted"
    | "status"
    | "model_started"
    | "model_attempt_started"
    | "model_delta"
    | "model_attempt_failed"
    | "model_completed"
    | "tool_started"
    | "tool_completed"
    | "compaction_started"
    | "compaction_completed";
  data: JsonValue;
};

export type DurableSnapshot = {
  run: DurableRunRecord;
  /** Committed operation state, including results produced before the run finishes. */
  operations: DurableOperation[];
  /** Global commit cursor; pass to stream({ after: cursor }) after rendering this snapshot. */
  cursor: number;
};

/** Synchronous, atomic transaction. Never perform external work inside its callback. */
export interface DurableTransaction extends TaskTransaction {
  pendingCounts(): { runs: number; tasks: number };
  operationCount(id: string): number;
  getGraph(id: string): DurableGraphRecord | undefined;
  findGraphRequest(sessionId: string, requestId: string): DurableGraphRecord | undefined;
  putGraph(graph: DurableGraphRecord): void;
  getRunSummary(id: string): DurableRunSummary | undefined;
  getRun(id: string): DurableRunRecord | undefined;
  findRequest(sessionId: string, requestId: string): DurableRunRecord | undefined;
  activeRun(sessionId: string): DurableRunRecord | undefined;
  latestCompleted(sessionId: string): DurableRunRecord | undefined;
  hasLaterStartedRun(id: string): boolean;
  putRun(run: DurableRunRecord): void;
  /** Expands shared histories for deterministic execution and checkpoint validation. */
  getOperation(runId: string, key: string): DurableOperation | undefined;
  /** Stored operation envelopes; does not expand shared histories. */
  operations(runId: string): DurableOperation[];
  putOperation(runId: string, operation: DurableOperation): void;
  appendEvent(runId: string, type: DurableEvent["type"], data: JsonValue): void;
  cursor(): number;
}

/** A store is exclusively owned by one open runtime. All returned values must be detached copies. */
export interface DurableStore {
  metrics(): DurableMetrics;
  listTasks(options: TaskListOptions): TaskPage;
  scheduleTasks(excluded: readonly string[], limit: number): string[];
  unsettledTaskRoots(after: number): { ids: string[]; cursor?: number };
  taskEvents(rootId: string, after: number, limit: number): DurableEvent[];
  acquire(): void;
  close(): void;
  transaction<T>(callback: (tx: DurableTransaction) => T): T;
  listGraphs(options: DurableGraphListOptions): DurableGraphPage;
  graphEvents(graphId: string, after: number, limit: number): DurableEvent[];
  list(options: DurableListOptions): DurableRunPage;
  /** Oldest eligible unfinished run per session, excluding executions still settling. */
  schedule(
    now: string,
    limit: number,
    excludedSessions: readonly string[],
  ): {
    ids: string[];
    nextAttemptAt?: string;
  };
  events(runId: string, after: number, limit: number): DurableEvent[];
}

export type DurableRuntimeOptions = {
  store: DurableStore;
  limits?: Partial<DurableLimits>;
  /** Called once after a fatal storage/scheduler failure; never includes task payloads automatically. */
  onFatalError?: (error: unknown) => void;
  agents?: readonly DurableAgentRegistration[];
  tasks?: readonly { readonly registration: RegisteredTask }[];
  /** Independent capacity for custom task phases. Waiting phases release their slot. */
  maxConcurrentTasks?: number;
  /** Maximum simultaneous executions across sessions. Defaults to 4. */
  maxConcurrentRuns?: number;
};

/** Lightweight owner metadata for application authorization. */
export type DurableRunScope = {
  runId: string;
  agentId: string;
  sessionId: string;
  graphId?: string;
  taskId?: string;
  rootTaskId?: string;
  taskName?: string;
};
