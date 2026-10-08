import type { AgentPrompt } from "@anvia/core/agent";
import type { AgentInteractionRequest } from "@anvia/core/agent/interactions";
import type { JsonValue } from "@anvia/core/completion";
import type { DurableEvent, DurableRunStatus } from "./types.js";

export type DurableTask = {
  id: string;
  agentId: string;
  prompt: AgentPrompt;
  dependsOn?: readonly string[];
};
export type DurableGraphSubmission = {
  sessionId: string;
  requestId: string;
  /** A static directed acyclic graph, limited to 100 tasks. */
  tasks: readonly DurableTask[];
};
export type DurableGraphRecord = {
  id: string;
  submission: DurableGraphSubmission;
  createdAt: string;
  cancelled: boolean;
  /** IDs are persisted atomically with the child runs. */
  runIds: Record<string, string>;
};
export type DurableTaskWait =
  | { type: "dependencies" | "dependency_failed"; taskIds: string[] }
  | { type: "capacity" }
  | { type: "interaction"; interactionId: string }
  | { type: "retry"; until: string }
  | { type: "recovery"; operationId?: string };
export type DurableGraphNode = {
  id: string;
  agentId: string;
  runId: string;
  status: DurableRunStatus;
  wait?: DurableTaskWait;
  output?: JsonValue;
  interaction?: AgentInteractionRequest;
  error?: string;
};
export type DurableGraphSnapshot = {
  id: string;
  sessionId: string;
  requestId: string;
  createdAt: string;
  status: "running" | "waiting" | "blocked" | "completed" | "cancelled";
  nodes: DurableGraphNode[];
  edges: { source: string; target: string }[];
  cursor: number;
};
export type DurableGraphEvent = DurableEvent & { graphId: string; taskId: string };
export type DurableGraphListOptions = {
  sessionId?: string | undefined;
  after?: number | undefined;
  limit?: number | undefined;
};
export type DurableGraphPage = {
  graphs: { id: string; sessionId: string; requestId: string; createdAt: string }[];
  nextCursor?: number;
};
