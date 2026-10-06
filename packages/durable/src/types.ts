import type {
  DurableGraphRecord,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";
import type { RegisteredTask, TaskListOptions, TaskPage, TaskTransaction } from "./tasks/types.js";
import type { Agent, AgentInput, AgentOutcome } from "@anvia/core/agent";
import type { JsonValue, Message, Usage } from "@anvia/core/completion";

export type ToolRecovery = "safe" | "idempotent" | "manual";

/** Opt-in retries for core completion-attempt errors, including validation and observers. */
export type DurableModelRetry = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
};

export type DurableAgentRegistration = {
  agent: Agent<unknown>;
  /** Bump whenever code, model, tools, schemas, or instructions change incompatibly. */
  version: string;
  /** Unlisted tools require reconciliation if interrupted after their intent was committed. */
  toolRecovery?: Readonly<Record<string, ToolRecovery>>;
  modelRetry?: DurableModelRetry;
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
  prompt: string;
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
  outcome?: AgentOutcome<unknown>;
  error?: string;
  blockedOperation?: string;
  modelRetry?: DurableModelRetry;
  nextAttemptAt?: string;
  responses: Record<string, JsonValue>;
};

export type DurableOperation = {
  key: string;
  kind: "model" | "tool" | "effect";
  input: JsonValue;
  status: "started" | "completed";
  recovery: ToolRecovery;
  result?: JsonValue | undefined;
  /** Persisted before each completion attempt, including interrupted attempts; reset by explicit retry(). */
  attempts?: number | undefined;
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
    | "model_completed"
    | "tool_started"
    | "tool_completed";
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
  getGraph(id: string): DurableGraphRecord | undefined;
  findGraphRequest(sessionId: string, requestId: string): DurableGraphRecord | undefined;
  putGraph(graph: DurableGraphRecord): void;
  getRun(id: string): DurableRunRecord | undefined;
  findRequest(sessionId: string, requestId: string): DurableRunRecord | undefined;
  activeRun(sessionId: string): DurableRunRecord | undefined;
  latestCompleted(sessionId: string): DurableRunRecord | undefined;
  hasLaterStartedRun(id: string): boolean;
  putRun(run: DurableRunRecord): void;
  getOperation(runId: string, key: string): DurableOperation | undefined;
  operations(runId: string): DurableOperation[];
  putOperation(runId: string, operation: DurableOperation): void;
  appendEvent(runId: string, type: DurableEvent["type"], data: JsonValue): void;
  cursor(): number;
}

/** A store is exclusively owned by one open runtime. All returned values must be detached copies. */
export interface DurableStore {
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
  agents?: readonly DurableAgentRegistration[];
  tasks?: readonly { readonly registration: RegisteredTask }[];
  /** Independent capacity for custom task phases. Waiting phases release their slot. */
  maxConcurrentTasks?: number;
  /** Maximum simultaneous executions across sessions. Defaults to 4. */
  maxConcurrentRuns?: number;
};
