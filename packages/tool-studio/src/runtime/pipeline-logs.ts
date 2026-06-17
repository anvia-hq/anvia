import type { JsonObject } from "@anvia/core/completion";
import type { PipelineGraphNode, PipelineRunEvent } from "@anvia/core/pipeline";
import type {
  StudioPipeline,
  StudioPipelineLogAppendInput,
  StudioPipelineLogEntry,
  StudioPipelineLogStore,
} from "../types";
import { compact } from "./compact";
import { formatUnknown } from "./json";
import { serializeError } from "./http";

export async function appendPipelineLog(
  store: StudioPipelineLogStore | undefined,
  input: StudioPipelineLogAppendInput,
): Promise<StudioPipelineLogEntry | undefined> {
  return store?.appendPipelineLog(input);
}

export async function* emitPipelineLog(
  store: StudioPipelineLogStore | undefined,
  input: StudioPipelineLogAppendInput,
): AsyncIterable<{ type: "pipeline_log"; log: StudioPipelineLogEntry }> {
  const log = await appendPipelineLog(store, input);
  if (log !== undefined) {
    yield { type: "pipeline_log", log };
  }
}

export function pipelineRunReceivedLog(props: {
  pipeline: StudioPipeline;
  runId: string;
  stream: boolean;
  input: unknown;
  metadata?: JsonObject;
}): StudioPipelineLogAppendInput {
  return {
    pipelineId: props.pipeline.id,
    runId: props.runId,
    level: "info",
    category: "api",
    event: "pipeline.run_received",
    message: "Pipeline run request received",
    metadata: compact({
      stream: props.stream,
      inputBytes: byteLength(formatUnknown(props.input)),
      metadataKeys: Object.keys(props.metadata ?? {}),
    }),
  };
}

export function pipelineRunStartedLog(
  pipeline: StudioPipeline,
  runId: string,
): StudioPipelineLogAppendInput {
  const graph = pipeline.pipeline.graph();
  return {
    pipelineId: pipeline.id,
    runId,
    level: "info",
    category: "run",
    event: "pipeline.run_started",
    message: "Pipeline run started",
    metadata: compact({
      stageCount: graph.nodes.filter((node) => node.kind !== "input" && node.kind !== "output")
        .length,
      edgeCount: graph.edges.length,
    }),
  };
}

export function pipelineRunCompletedLog(props: {
  pipelineId: string;
  runId: string;
  durationMs: number;
  output: unknown;
}): StudioPipelineLogAppendInput {
  return {
    pipelineId: props.pipelineId,
    runId: props.runId,
    level: "info",
    category: "run",
    event: "pipeline.run_completed",
    message: "Pipeline run completed",
    metadata: compact({
      durationMs: props.durationMs,
      outputBytes: byteLength(formatUnknown(props.output)),
    }),
  };
}

export function pipelineRunFailedLog(
  pipelineId: string,
  runId: string,
  error: unknown,
  startedAt: number,
): StudioPipelineLogAppendInput {
  return {
    pipelineId,
    runId,
    level: "error",
    category: "run",
    event: "pipeline.run_failed",
    message: "Pipeline run failed",
    metadata: compact({
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    }),
  };
}

export function pipelineStageLog(
  pipelineId: string,
  runId: string,
  event: PipelineRunEvent,
): StudioPipelineLogAppendInput {
  const category = stageCategory(event.node);
  if (event.type === "stage_started") {
    return {
      pipelineId,
      runId,
      level: "debug",
      category,
      event: `${event.node.kind}.started`,
      message: `${event.node.label} started`,
      metadata: nodeMetadata(event.node),
    };
  }
  if (event.type === "stage_completed") {
    return {
      pipelineId,
      runId,
      level: "debug",
      category,
      event: `${event.node.kind}.completed`,
      message: `${event.node.label} completed`,
      metadata: compact({
        ...nodeMetadata(event.node),
        durationMs: event.durationMs,
      }),
    };
  }
  return {
    pipelineId,
    runId,
    level: "error",
    category,
    event: `${event.node.kind}.failed`,
    message: `${event.node.label} failed`,
    metadata: compact({
      ...nodeMetadata(event.node),
      durationMs: event.durationMs,
      error: serializeError(event.error),
    }),
  };
}

function stageCategory(node: PipelineGraphNode): StudioPipelineLogAppendInput["category"] {
  if (node.kind === "parallel" || node.kind === "branch") {
    return "parallel";
  }
  if (node.kind === "agent") {
    return "agent";
  }
  if (node.kind === "extractor") {
    return "extractor";
  }
  return "stage";
}

function nodeMetadata(node: PipelineGraphNode): JsonObject {
  return compact({
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    agentId: node.agentId,
    pipelineId: node.pipelineId,
    branchKey: node.branchKey,
  });
}

function byteLength(value: string | undefined): number | undefined {
  return value === undefined ? undefined : new TextEncoder().encode(value).length;
}
