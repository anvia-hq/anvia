import type { DurableLimits } from "./limits.js";
import type { DurableMetrics } from "./metrics.js";
import type {
  DurableGraphRecord,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";
import type { RegisteredTask, TaskListOptions, TaskPage, TaskTransaction } from "./tasks/types.js";
import type { Agent, AgentInput, AgentOutcome, AgentPrompt } from "@anvia/core/agent";
import type {
  Document,
  JsonObject,
  JsonValue,
  Message,
  Usage,
  UserMessage,
} from "@anvia/core/completion";
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
  /**
   * How many tool calls of one model turn may run at once. Defaults to 1. A turn that calls a
   * question tool or a tool that may require approval still runs in order. Fixed per registration, not
   * per run.
   */
  toolConcurrency?: number;
  /** Unlisted tools require reconciliation if interrupted after their intent was committed. */
  toolRecovery?: Readonly<Record<string, ToolRecovery>>;
  modelRetry?: DurableModelRetry;
  /** Bump registration.version when the compactor or token counter changes. */
  compaction?: DurableCompactionOptions;
  /**
   * Declares the agent's `lifecycle` hooks observational. Each hook then runs once per step: a
   * record is committed before the hook, and a replayed step never fires it again. Hook failures
   * are recorded and do not fail the run. Without this marker, `lifecycle` is rejected.
   */
  lifecycle?: DurableObservationalLifecycle;
  /**
   * Declares the agent's `middlewares` pure: deterministic, no external effects. Replay runs them
   * again and compares the transformed request or tool input with the persisted one. Without this
   * marker, `middlewares` is rejected.
   */
  middlewares?: DurablePureMiddleware;
  /**
   * Admits the agent's `guardrails`. Each check's outcome is recorded before it is applied, and a
   * replayed check is never run again. Without this marker, `guardrails` is rejected.
   */
  guardrails?: DurableRecordedGuardrails;
  /**
   * Admits the agent's provider-executed tools. The marker declares that the provider keeps no
   * state between calls, so a replayed model request reproduces the provider's behaviour. The
   * definitions are part of the persisted model request, so a changed definition fails replay.
   * Without this marker, provider tools are rejected.
   */
  providerTools?: DurableStatelessProviderTools;
  /**
   * Admits the agent's `mcpServers`. The servers' discovered tool lists and definitions are
   * fingerprinted at submission and checked at every execution start, so a changed server under the
   * same version fails the run. Each call is a tool operation with the registration's
   * `toolRecovery` policy (default `manual`). Without this marker, MCP servers are rejected.
   */
  mcpServers?: DurablePinnedMcpServers;
  /**
   * Admits the agent's `toolIndexes`. Each model call's selected tools are recorded before the
   * model call and reused on replay, so the search does not run again. The registration's index
   * fingerprint is frozen at submission and checked at each execution start. Without this marker,
   * tool indexes are rejected.
   */
  toolIndexes?: DurableRecordedToolIndexes;
  /**
   * Admits the agent's `memory`. The read snapshot is recorded before the first model call and
   * reused on replay. Each write is recorded as a memory operation keyed by a runtime-derived
   * idempotency key, and the save policy runs after the run's terminal checkpoint. Without this
   * marker, memory is rejected.
   */
  memory?: DurableRecordedMemory;
};

/** The only lifecycle mode durable admits: hooks that observe the run and do not change it. */
export type DurableObservationalLifecycle = { mode: "observe" };

/** The only middleware mode durable admits: deterministic transforms without external effects. */
export type DurablePureMiddleware = { mode: "pure" };

/** The only guardrail mode durable admits: checks whose outcomes are recorded before use. */
export type DurableRecordedGuardrails = { mode: "record" };

/** The only provider-tool mode durable admits: the provider keeps no state between calls. */
export type DurableStatelessProviderTools = { mode: "stateless" };

/** The only MCP mode durable admits: the servers discovered at registration are pinned per run. */
export type DurablePinnedMcpServers = { mode: "pinned" };
/** The only tool-index mode durable admits: each model call's selection is recorded and reused. */
export type DurableRecordedToolIndexes = { mode: "recorded" };

/** The only memory mode durable admits: reads and writes are recorded by the runtime. */
export type DurableRecordedMemory = { mode: "recorded" };

/**
 * How an operator settles a blocked memory write: `applied` says the store already holds the
 * messages, `discarded` drops them.
 */
export type MemoryWriteResolution = "applied" | "discarded";

/** Agent-level options the runtime freezes for the life of a registration. */
export type DurableFrozenAgentOption =
  | "maxTurns"
  | "controls"
  | "toolChoice"
  | "temperature"
  | "maxTokens"
  | "providerOptions"
  | "outputSchema";

/**
 * Per-run `AgentRunSettings` fields that durable manages itself or does not expose. `toolConcurrency`
 * is only configurable per registration (`DurableAgentRegistration.toolConcurrency`).
 */
export type DurableUnavailableRunSetting =
  | "retries"
  | "maxTurns"
  | "controls"
  | "lifecycle"
  | "guardrails"
  | "middlewares"
  | "toolConcurrency"
  | "session";

/**
 * Detached description of one registered agent's durable compatibility. It reports what the
 * runtime actually honours; it never implies support for a rejected feature.
 */
export type DurableAgentCompatibility = {
  agentId: string;
  version: string;
  /** Static local tool names, including tools flattened from `skills`. */
  tools: readonly string[];
  streaming: boolean;
  /** Effective registered tool concurrency (1 when unset). Core may still lower it per agent. */
  toolConcurrency: number;
  compaction: boolean;
  /** Undefined when the registration has no model retry policy. */
  modelRetry: DurableModelRetry | undefined;
  /** Agent-level options captured by the runtime and not overridable per run. */
  frozen: readonly DurableFrozenAgentOption[];
  /** Per-run settings durable does not expose; see the package docs. */
  unavailable: readonly DurableUnavailableRunSetting[];
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

/**
 * Observer trace context for durable work. The runtime adds a trace ID shared by every execution of
 * a run and durable identifiers under `metadata.durable*`.
 */
export type DurableTraceOptions = {
  /**
   * Observability session that groups traces, such as one chat across its turns, goals, and
   * subagents. It only affects observers; execution sessions, histories, and ownership stay
   * separate. Defaults to the submitted session. Use a globally unique value, such as a chat ID,
   * because observability backends group by this value alone.
   */
  sessionId?: string | undefined;
  name?: string | undefined;
  userId?: string | undefined;
  tags?: string[] | undefined;
  metadata?: JsonObject | undefined;
  version?: string | undefined;
};

export type DurableSubmission = {
  agentId: string;
  sessionId: string;
  requestId: string;
  /** Text or a structured user message, including image/file content. */
  prompt: AgentPrompt;
  /** Not part of request deduplication; the first accepted submission's value is kept. */
  trace?: DurableTraceOptions | undefined;
};

/** Reuse requestId when retrying delivery of the same steering input. Scoped to one run. */
export type DurableSteerOptions = { requestId?: string };

export type DurableSteeringEntry = { id: string; messages: UserMessage[] };

/** Empty boundaries are persisted too, so later input cannot alter replayed requests. */
export type DurableSteeringState = {
  pending: DurableSteeringEntry[];
  checkpoints: Record<string, { turn: number; closing: boolean; entries: DurableSteeringEntry[] }>;
  closed: boolean;
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
  /** Explicit retry() count. Keys the failure hooks, so each failure after a retry is observed. */
  retries?: number | undefined;
  input: AgentInput;
  modelTurns: number;
  maxModelTurns: number;
  usage: Usage;
  /** Canonical history before this submission, retained across interaction continuations. */
  history: Message[];
  /**
   * A finished run whose conversation this run continues instead of its session's latest
   * completed run. Set for owned agent tasks spawned with `continueFrom`.
   */
  continueFrom?: string;
  compaction?: DurableCompactionPolicy;
  contextCheckpoint?: DurableContextCheckpoint;
  /**
   * Static context documents frozen at submission: a content hash plus the resolved documents.
   * Replay verifies the registration still resolves to the same hash. Large document sets persist
   * as a blob reference; readers through the runtime API always see the hydrated form.
   */
  contextDocuments?: { hash: string; documents?: Document[] };
  /** Fingerprint of the pinned MCP servers at submission; see mcp-servers.ts. */
  mcpServers?: { hash: string };
  /** Fingerprint of the tool indexes at submission; see tool-indexes.ts. */
  toolIndexes?: { hash: string };
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
  /** Absent on legacy runs, which retain their original execution boundaries. */
  steering?: DurableSteeringState;
};

export type DurableOperation = {
  /** SQLite snapshot histories are immutable linked-log references; use operationRequest(). */
  historyEncoding?: "linked-v1" | undefined;
  key: string;
  kind: "model" | "tool" | "effect" | "compaction" | "context" | "memory";
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
    | "steering_queued"
    | "steering_applied"
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
  /**
   * Stores an immutable JSON value in the overflow area and returns its content hash. Blob writes
   * share the caller's transaction and are not payload-checked; the bounded reference written
   * beside them is. A committed reference is never dangling.
   */
  putBlob(value: JsonValue): string;
  /** Reads a blob back by content hash; a missing or corrupt blob throws. */
  getBlob(hash: string): JsonValue;
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
  /**
   * Receives a detached compatibility report after `open()` and after each successful
   * `registerAgents()` call, so a host can log what the runtime does and does not honour.
   */
  onCompatibility?: (report: readonly DurableAgentCompatibility[]) => void | Promise<void>;
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
