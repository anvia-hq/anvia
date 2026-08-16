import type { z } from "zod";
import type { JsonObject } from "../completion";
import type { Pipeline } from "./pipeline";

export type PipelineMetadata = {
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type PipelineOptions<Input, Parsed = Input> = {
  id: string;
  inputSchema: z.ZodType<Parsed, Input>;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type PipelineStageMetadata = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type PipelineStageContext<Input> = {
  input: Input;
  runId: string;
  pipelineId: string;
  runMetadata?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type PipelineStageKind =
  | "input"
  | "step"
  | "pipeline"
  | "parallel"
  | "branch"
  | "agent"
  | "extractor"
  | "output";

export type PipelineNodePath = readonly string[];

export type PipelineGraphNode = {
  id: string;
  path: PipelineNodePath;
  kind: PipelineStageKind;
  label: string;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
  agentId?: string | undefined;
  agentName?: string | undefined;
  pipelineId?: string | undefined;
  branchKey?: string | undefined;
};

export type PipelineGraphEdge = {
  id: string;
  source: PipelineNodePath;
  target: PipelineNodePath;
  label?: string | undefined;
};

export type PipelineGraph = PipelineMetadata & {
  id: string;
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
};

type PipelineRunEventBase = {
  runId: string;
  pipelineId: string;
  path: PipelineNodePath;
  node: PipelineGraphNode;
};

export type PipelineRunEvent =
  | (PipelineRunEventBase & { type: "stage_started" })
  | (PipelineRunEventBase & {
      type: "stage_completed";
      durationMs: number;
    })
  | (PipelineRunEventBase & {
      type: "stage_failed";
      durationMs: number;
      error: unknown;
    });

export type PipelineRunObserver = {
  onEvent(event: PipelineRunEvent): void | Promise<void>;
};

export type PipelineRunOptions<Input> = {
  input: Input;
  runId?: string | undefined;
  metadata?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
  observer?: PipelineRunObserver | undefined;
  failOnObserverError?: boolean | undefined;
};

export type PipelineRunResult<Output> = {
  runId: string;
  output: Awaited<Output>;
};

export type PipelineBatchOptions<Input> = {
  inputs: Iterable<Input>;
  concurrency: number;
  metadata?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
  observer?: PipelineRunObserver | undefined;
  failOnObserverError?: boolean | undefined;
};

export type PipelineBatchItem<Output> =
  | {
      status: "completed";
      runId: string;
      output: Awaited<Output>;
    }
  | {
      status: "failed";
      runId: string;
      error: unknown;
    };

export type PipelineOutput<Value> =
  Value extends Pipeline<infer _Input, infer Output> ? Awaited<Output> : never;

export type ParallelOutput<Branches extends Record<string, unknown>> = {
  [Key in keyof Branches]: PipelineOutput<Branches[Key]>;
};

export type PipelineRunContext = {
  runId: string;
  pipelineId: string;
  runMetadata?: JsonObject | undefined;
  abortSignal?: AbortSignal | undefined;
  observer?: PipelineRunObserver | undefined;
  failOnObserverError: boolean;
};

export type PipelineExecutor<Input, Output> = (
  input: Input,
  context: PipelineRunContext,
  pathPrefix: PipelineNodePath,
) => Output | Promise<Output>;

export type PipelineState = {
  graph: PipelineGraph;
  terminalPaths: PipelineNodePath[];
  stageIds: ReadonlySet<string>;
  nextEdgeIndex: number;
};
