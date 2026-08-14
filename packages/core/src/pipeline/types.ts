import type { z } from "zod";
import type { JsonObject } from "../completion";

/** Minimal interface for anything that can run as a pipeline stage. */
export interface PipelineOp<Input = unknown, Output = unknown> {
  run(input: Input): Output | Promise<Output>;
}

export interface PipelineBatchOptions {
  /** Maximum number of inputs processed at the same time. */
  concurrency: number;
}

export type AwaitedOutput<Op> =
  Op extends PipelineOp<unknown, infer Output> ? Awaited<Output> : never;

export type ParallelOutput<Branches extends Record<string, PipelineOp<unknown, unknown>>> = {
  [Key in keyof Branches]: AwaitedOutput<Branches[Key]>;
};

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
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  metadata?: JsonObject | undefined;
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

export type PipelineGraphNode = {
  id: string;
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
  source: string;
  target: string;
  label?: string | undefined;
};

export type PipelineGraph = PipelineMetadata & {
  id: string;
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
};

export type PipelineRunEvent =
  | {
      type: "stage_started";
      node: PipelineGraphNode;
    }
  | {
      type: "stage_completed";
      node: PipelineGraphNode;
      durationMs: number;
    }
  | {
      type: "stage_failed";
      node: PipelineGraphNode;
      durationMs: number;
      error: unknown;
    };

export type PipelineRunObserver = {
  onEvent(event: PipelineRunEvent): void | Promise<void>;
};

export type PipelineRunOptions = {
  observer?: PipelineRunObserver | undefined;
};

export type PipelineRunContext = {
  observer?: PipelineRunObserver | undefined;
};

export type PipelineExecutor<Input, Output> = (
  input: Input,
  context: PipelineRunContext,
) => Output | Promise<Output>;

export type PipelineState = {
  graph: PipelineGraph;
  terminalNodeId: string;
  terminalNodeIds: string[];
  nextNodeIndex: number;
  nextEdgeIndex: number;
};
