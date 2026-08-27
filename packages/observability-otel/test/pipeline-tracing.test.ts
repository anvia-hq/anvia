import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { createOtelPipelineObserver } from "../src/index";
import { FakeTracer } from "./helpers/fake-tracer";

describe("OpenTelemetry Pipeline observer", () => {
  it("maps Pipeline runs and nested stages to parented OpenTelemetry spans", async () => {
    const tracer = new FakeTracer();
    const tracing = createOtelPipelineObserver({
      tracer: tracer.tracer,
      serviceName: "cookbook",
      captureMode: "full",
    });
    const run = await tracing.startRun({
      runId: "pipeline-run",
      pipelineId: "research",
      pipelineName: "Research",
      pipelineDescription: "Research a topic",
      pipelineMetadata: { owner: "platform" },
      runMetadata: { tenant: "acme" },
      trace: { sessionId: "session-1", metadata: { requestId: "request-1" } },
      input: "Anvia",
    });
    const parallel = await run?.startStage?.({
      runId: "pipeline-run",
      pipelineId: "research",
      path: ["fanout"],
      node: { id: "fanout", path: ["fanout"], kind: "parallel", label: "Fan out" },
      input: "ANVIA",
    });
    const branch = await run?.startStage?.({
      runId: "pipeline-run",
      pipelineId: "research",
      path: ["fanout", "web"],
      node: {
        id: "web",
        path: ["fanout", "web"],
        kind: "branch",
        label: "Web",
        branchKey: "web",
      },
      input: "ANVIA",
    });

    await branch?.end({
      runId: "pipeline-run",
      pipelineId: "research",
      path: ["fanout", "web"],
      node: {
        id: "web",
        path: ["fanout", "web"],
        kind: "branch",
        label: "Web",
      },
      output: ["result"],
      durationMs: 4,
    });
    await parallel?.end({
      runId: "pipeline-run",
      pipelineId: "research",
      path: ["fanout"],
      node: { id: "fanout", path: ["fanout"], kind: "parallel", label: "Fan out" },
      output: { web: ["result"] },
      durationMs: 5,
    });
    await run?.end({
      runId: "pipeline-run",
      pipelineId: "research",
      output: { web: ["result"] },
      durationMs: 6,
    });

    const [root, parallelSpan, branchSpan] = tracer.spans;
    expect(root?.name).toBe("pipeline.Research");
    expect(root?.attributes).toMatchObject({
      "service.name": "cookbook",
      "anvia.run.id": "pipeline-run",
      "anvia.pipeline.id": "research",
      "anvia.pipeline.name": "Research",
      "anvia.pipeline.input": '"Anvia"',
      "anvia.pipeline.metadata.owner": "platform",
      "anvia.run.metadata.tenant": "acme",
      "anvia.trace.session_id": "session-1",
      "anvia.trace.metadata.requestId": "request-1",
      "anvia.run.status": "completed",
    });
    expect(run?.trace).toEqual({
      traceId: root?.spanContextValue.traceId,
      observationId: root?.spanContextValue.spanId,
    });
    expect(parallelSpan?.name).toBe("parallel.fanout");
    expect(parallelSpan?.parentSpanId).toBe(root?.spanContextValue.spanId);
    expect(branchSpan?.name).toBe("branch.web");
    expect(branchSpan?.parentSpanId).toBe(parallelSpan?.spanContextValue.spanId);
    expect(branchSpan?.attributes).toMatchObject({
      "anvia.pipeline.stage.path": "fanout/web",
      "anvia.pipeline.stage.branch_key": "web",
      "anvia.pipeline.stage.output": '["result"]',
    });
    expect(tracer.spans.every((span) => span.ended)).toBe(true);
  });

  it("records Pipeline stage and run failures", async () => {
    const tracer = new FakeTracer();
    const tracing = createOtelPipelineObserver({ tracer: tracer.tracer });
    const run = await tracing.startRun({
      runId: "pipeline-run",
      pipelineId: "failing",
      input: "input",
    });
    if (run === undefined) throw new Error("Expected a Pipeline run observer");
    const stage = await run.startStage?.({
      runId: "pipeline-run",
      pipelineId: "failing",
      path: ["fail"],
      node: { id: "fail", path: ["fail"], kind: "step", label: "Fail" },
      input: "input",
    });

    await stage?.error?.({
      runId: "pipeline-run",
      pipelineId: "failing",
      path: ["fail"],
      node: { id: "fail", path: ["fail"], kind: "step", label: "Fail" },
      error: new Error("stage failed"),
      durationMs: 2,
    });
    await run.error?.({
      runId: "pipeline-run",
      pipelineId: "failing",
      status: "failed",
      error: new Error("pipeline failed"),
      durationMs: 3,
    });

    expect(tracer.spans[1]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "stage failed",
    });
    expect(tracer.spans[0]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "pipeline failed",
    });
    expect(tracer.spans.every((span) => span.ended)).toBe(true);
  });
});
