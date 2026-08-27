import type {
  PipelineObserver,
  PipelineRunEndArgs,
  PipelineRunErrorArgs,
  PipelineRunObservation,
  PipelineRunStartArgs,
  PipelineStageEndArgs,
  PipelineStageErrorArgs,
  PipelineStageObservation,
  PipelineStageStartArgs,
} from "@anvia/core/pipeline";
import {
  type Attributes,
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import {
  capturedJson,
  compactAttributes,
  emptyToUndefined,
  metadataAttributes,
  parentContextFromTraceId,
  recordSpanError,
} from "./helpers.js";
import type { OtelPipelineObserverOptions } from "./types.js";

export function createOtelPipelineObserver(
  options: OtelPipelineObserverOptions = {},
): PipelineObserver {
  return new OtelPipelineObserver(options);
}

class OtelPipelineObserver implements PipelineObserver {
  private readonly tracer: Tracer;

  constructor(private readonly options: OtelPipelineObserverOptions) {
    this.tracer =
      options.tracer ??
      trace.getTracer(
        emptyToUndefined(options.tracerName) ?? "@anvia/otel",
        emptyToUndefined(options.tracerVersion),
      );
  }

  startRun(args: PipelineRunStartArgs): PipelineRunObservation {
    const parentContext = parentContextFromTraceId(
      args.trace?.traceId,
      args.trace?.parentObservationId,
    );
    const root = this.tracer.startSpan(
      `pipeline.${args.pipelineName ?? args.pipelineId}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: pipelineRunStartAttributes(args, this.options),
      },
      parentContext,
    );
    return new OtelPipelineRunObserver(this.tracer, root, this.options);
  }
}

class OtelPipelineRunObserver implements PipelineRunObservation {
  readonly trace;
  private readonly rootContext: Context;
  private readonly stageContexts = new Map<string, Context>();

  constructor(
    private readonly tracer: Tracer,
    private readonly root: Span,
    private readonly options: OtelPipelineObserverOptions,
  ) {
    const spanContext = root.spanContext();
    this.trace = { traceId: spanContext.traceId, observationId: spanContext.spanId };
    this.rootContext = trace.setSpan(ROOT_CONTEXT, root);
  }

  startStage(args: PipelineStageStartArgs): PipelineStageObservation {
    const key = pathKey(args.path);
    const parent = this.stageContexts.get(pathKey(args.path.slice(0, -1))) ?? this.rootContext;
    const stage = this.tracer.startSpan(
      `${args.node.kind}.${args.node.id}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: pipelineStageStartAttributes(args, this.options),
      },
      parent,
    );
    this.stageContexts.set(key, trace.setSpan(ROOT_CONTEXT, stage));
    return new OtelPipelineStageObserver(stage, () => this.stageContexts.delete(key), this.options);
  }

  end(args: PipelineRunEndArgs): void {
    this.root.setAttributes(pipelineRunEndAttributes(args, this.options));
    this.root.setStatus({ code: SpanStatusCode.OK });
    this.root.end();
  }

  error(args: PipelineRunErrorArgs): void {
    recordSpanError(this.root, args.error);
    this.root.setAttributes({
      "anvia.run.status": args.status,
      "anvia.run.duration_ms": args.durationMs,
    });
    this.root.end();
  }
}

class OtelPipelineStageObserver implements PipelineStageObservation {
  readonly trace;

  constructor(
    private readonly span: Span,
    private readonly cleanup: () => void,
    private readonly options: OtelPipelineObserverOptions,
  ) {
    const spanContext = span.spanContext();
    this.trace = { traceId: spanContext.traceId, observationId: spanContext.spanId };
  }

  end(args: PipelineStageEndArgs): void {
    this.span.setAttributes({
      "anvia.pipeline.stage.duration_ms": args.durationMs,
      "anvia.pipeline.stage.output": capturedJson(args.output, "output", this.options),
    });
    this.span.setStatus({ code: SpanStatusCode.OK });
    this.finish();
  }

  error(args: PipelineStageErrorArgs): void {
    recordSpanError(this.span, args.error);
    this.span.setAttribute("anvia.pipeline.stage.duration_ms", args.durationMs);
    this.finish();
  }

  private finish(): void {
    this.cleanup();
    this.span.end();
  }
}

function pipelineRunStartAttributes(
  args: PipelineRunStartArgs,
  options: OtelPipelineObserverOptions,
): Attributes {
  return compactAttributes({
    "service.name": options.serviceName,
    "anvia.run.id": args.runId,
    "anvia.pipeline.id": args.pipelineId,
    "anvia.pipeline.name": args.pipelineName,
    "anvia.pipeline.description": args.pipelineDescription,
    "anvia.pipeline.input": capturedJson(args.input, "input", options),
    "anvia.trace.name": args.trace?.name ?? args.pipelineName ?? args.pipelineId,
    "anvia.trace.user_id": args.trace?.userId,
    "anvia.trace.session_id": args.trace?.sessionId,
    "anvia.trace.tags": args.trace?.tags === undefined ? undefined : [...args.trace.tags],
    "anvia.trace.version": args.trace?.version,
    ...metadataAttributes("anvia.pipeline.metadata", args.pipelineMetadata),
    ...metadataAttributes("anvia.run.metadata", args.runMetadata),
    ...metadataAttributes("anvia.trace.metadata", args.trace?.metadata),
  });
}

function pipelineRunEndAttributes(
  args: PipelineRunEndArgs,
  options: OtelPipelineObserverOptions,
): Attributes {
  return compactAttributes({
    "anvia.run.status": "completed",
    "anvia.run.duration_ms": args.durationMs,
    "anvia.pipeline.output": capturedJson(args.output, "output", options),
  });
}

function pipelineStageStartAttributes(
  args: PipelineStageStartArgs,
  options: OtelPipelineObserverOptions,
): Attributes {
  return compactAttributes({
    "anvia.pipeline.stage.id": args.node.id,
    "anvia.pipeline.stage.kind": args.node.kind,
    "anvia.pipeline.stage.path": args.path.join("/"),
    "anvia.pipeline.stage.label": args.node.label,
    "anvia.pipeline.stage.description": args.node.description,
    "anvia.pipeline.stage.input": capturedJson(args.input, "input", options),
    "anvia.pipeline.stage.agent_id": args.node.agentId,
    "anvia.pipeline.stage.agent_name": args.node.agentName,
    "anvia.pipeline.stage.pipeline_id": args.node.pipelineId,
    "anvia.pipeline.stage.branch_key": args.node.branchKey,
    ...metadataAttributes("anvia.pipeline.stage.metadata", args.node.metadata),
  });
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}
