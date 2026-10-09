import type { AgentPrompt } from "@anvia/core/agent";
import type { JsonValue } from "@anvia/core/completion";
import type { z } from "zod";
import type { ToolRecovery, DurableRunStatus, DurableRunRecord } from "../types.js";

export type TaskAgentInput = {
  agentId: string;
  prompt: AgentPrompt;
  /** Optional lower cap, including the initial model response. */
  maxModelTurns?: number;
};

export type TaskOutcome<R = JsonValue> =
  | { status: "completed"; output: R }
  | { status: "failed" | "cancelled"; error: string };
export type TaskWait =
  | { type: "children"; ids: string[]; policy: "allSettled" | "failFast" }
  | { type: "timer"; until: string }
  | { type: "agent"; runId: string; status: DurableRunStatus }
  | { type: "signal"; name: string };
export type TaskTransition<S, R> =
  | { status: "pending"; checkpoint: S }
  | { status: "waiting"; checkpoint: S; wait: TaskWait }
  | TaskOutcome<R>;

export type TaskContext<I, S> = {
  readonly id: string;
  readonly input: I;
  readonly checkpoint: S;
  readonly signal: AbortSignal;
  /** The key is unique for this parent's lifetime. Replay returns the same child. */
  spawn<CI, CS, CR>(key: string, task: TaskDefinition<CI, CS, CR>, input: CI): string;
  spawnAgent(key: string, input: TaskAgentInput): string;
  /** Read a direct owned agent child's persisted execution state. */
  agentRun(childId: string): DurableRunRecord;
  children(): TaskRecord[];
  signalValue(name: string): JsonValue | undefined;
  /** Effects default to manual reconciliation after an uncertain interruption. */
  effect<T extends JsonValue>(
    key: string,
    input: JsonValue,
    execute: (operationId: string, signal: AbortSignal) => Promise<T>,
    recovery?: ToolRecovery,
  ): Promise<T>;
};

export type TaskDefinition<I, S, R> = {
  readonly name: string;
  readonly version: number;
  readonly input: z.ZodType<I>;
  readonly checkpoint: z.ZodType<S>;
  readonly output: z.ZodType<R>;
  /** Pure initialization; submission authorization may evaluate this before persisting work. */
  readonly initial: (input: I) => S;
  /** Re-entered from the last committed checkpoint; external effects belong in effect(). */
  readonly run: (context: TaskContext<I, S>) => Promise<TaskTransition<S, R>>;
  readonly migrate?: (
    input: JsonValue,
    checkpoint: JsonValue,
    fromVersion: number,
  ) => {
    input: I;
    checkpoint: S;
  };
};

export type DefinedTask<I, S, R> = TaskDefinition<I, S, R> & {
  readonly registration: RegisteredTask;
};

/** Type-erased at registration; schemas enforce every persisted boundary. */
export type RegisteredTask = {
  readonly name: string;
  readonly version: number;
  parseInput(value: unknown): JsonValue;
  parseCheckpoint(value: unknown): JsonValue;
  parseOutput(value: unknown): JsonValue;
  initial(input: JsonValue): JsonValue;
  /** Agent registrations required at submission, including deduplicated submissions. */
  agentDependencies?(input: JsonValue, checkpoint: JsonValue): readonly string[];
  run(context: TaskContext<JsonValue, JsonValue>): Promise<TaskTransition<JsonValue, JsonValue>>;
  migrate?: (
    input: JsonValue,
    checkpoint: JsonValue,
    version: number,
  ) => {
    input: JsonValue;
    checkpoint: JsonValue;
  };
};

export type TaskRecord = {
  id: string;
  rootId: string;
  parentId?: string;
  agentRunId?: string;
  depth: number;
  sessionId: string;
  key: string;
  name: string;
  version: number;
  submissionVersion: number;
  /** Original input for deduplication, even after migration. */
  submissionInput: JsonValue;
  input: JsonValue;
  checkpoint: JsonValue;
  status:
    | "pending"
    | "running"
    | "waiting"
    | "completing"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "needs_attention";
  wait?: TaskWait;
  outcome?: TaskOutcome;
  error?: string;
  blockedOperation?: string;
  signals: Record<string, { requestId: string; value: JsonValue }>;
  createdAt: string;
  updatedAt: string;
};

export type TaskListOptions = {
  sessionId?: string | undefined;
  after?: number | undefined;
  limit?: number | undefined;
};
export type TaskPage = { tasks: TaskRecord[]; nextCursor?: number };
export type TaskGraphSnapshot = {
  rootId: string;
  nodes: TaskRecord[];
  edges: { source: string; target: string; type: "owns" | "waits" }[];
  cursor: number;
};
export type TaskEvent = {
  rootId: string;
  sequence: number;
  taskId: string;
  createdAt: string;
  type: "submitted" | "status";
  data: JsonValue;
};

export interface TaskTransaction {
  getTask(id: string): TaskRecord | undefined;
  findTask(sessionId: string, parentId: string | undefined, key: string): TaskRecord | undefined;
  putTask(task: TaskRecord): void;
  taskChildren(id: string): TaskRecord[];
  taskTree(rootId: string): TaskRecord[];
}
