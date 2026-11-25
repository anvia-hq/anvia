import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudioConfig, StudioTrace, StudioTraceObservation } from "../src/types";
import { TraceBrowser } from "../src/ui/app/modules/tracing/trace-browser";

const agents: StudioConfig["agents"] = [{ id: "support", name: "Support", quickPrompts: [] }];

describe("TraceBrowser rendering", () => {
  it("renders the trace table with status, agent, and timing summaries", () => {
    const html = render({ traces: [trace()] });

    expect(html).toContain("trace_1");
    expect(html).toContain("session_1");
    expect(html).toContain("Support");
    expect(html).toContain("success");
    expect(html).toContain("1.2s");
    expect(html).toContain("36");
    expect(html).toContain("2");
  });

  it("renders selected trace detail and session timeline views", () => {
    const selected = trace();
    const sibling = trace({ id: "trace_2", name: "follow-up", startedAt: "2026-06-20T12:01:00Z" });

    const detailHtml = render({
      traces: [selected, sibling],
      selectedTraceId: selected.id,
    });
    expect(detailHtml).toContain("support-run");
    expect(detailHtml).toContain("agent.run");
    expect(detailHtml).toContain("turn.1");
    expect(detailHtml).toContain("model.generate");
    expect(detailHtml).toContain("tool.lookup");
    expect(detailHtml).toContain('aria-current="true"');

    const sessionHtml = render({
      traces: [selected, sibling],
      selectedTraceId: selected.id,
      traceSessionDetailId: selected.sessionId,
    });
    expect(sessionHtml).toContain("follow-up");
  });

  it("breaks the input tokens down for a selected trace", () => {
    const selected = trace();
    const generation = selected.observations.find((item) => item.kind === "generation");

    if (generation === undefined) throw new Error("generation observation missing");

    generation.metadata = {
      ...generation.metadata,
      context: {
        segments: [
          { id: "instructions", tokens: 1_200, characters: 4_800, items: 1 },
          { id: "messages", tokens: 300, characters: 1_200, items: 2 },
          { id: "mcpTools", tokens: 2_500, characters: 10_000, items: 12 },
        ],
        estimatedTokens: 4_000,
        reportedInputTokens: 4_000,
      },
    };

    const html = render({ traces: [selected], selectedTraceId: selected.id });

    expect(html).toContain("Split of reported input");
    expect(html).toContain("System prompt");
    expect(html).toContain("MCP tools");
    expect(html).toContain("4,000 tokens");
    expect(html).toContain("63%");
  });

  it("omits the context panel when a trace recorded no split", () => {
    const selected = trace();
    const html = render({ traces: [selected], selectedTraceId: selected.id });

    expect(html).not.toContain("Split of reported input");
    expect(html).not.toContain("Estimated split");
  });
});

function render(overrides: Partial<Parameters<typeof TraceBrowser>[0]> = {}): string {
  return renderToStaticMarkup(
    <TraceBrowser
      agents={agents}
      traces={[]}
      tracesEnabled={true}
      traceLoadState="idle"
      selectedTraceId=""
      traceSessionDetailId={undefined}
      onRefresh={vi.fn()}
      onSelectTrace={vi.fn()}
      onShowSessionTraces={vi.fn()}
      {...overrides}
    />,
  );
}

function trace(overrides: Partial<StudioTrace> = {}): StudioTrace {
  const observations = overrides.observations ?? [
    observation({
      id: "agent",
      kind: "agent",
      name: "agent.run",
      durationMs: 100,
      input: { prompt: "Hello" },
      output: { choice: [{ type: "text", text: "Hi" }] },
      metadata: { firstDeltaMs: 36, agentId: "support" },
    }),
    observation({
      id: "generation",
      parentObservationId: "agent",
      kind: "generation",
      name: "model.generate",
      durationMs: 700,
      output: { usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 } },
      metadata: { provider: "test", model: "alpha", messageId: "msg_1" },
    }),
    observation({
      id: "tool",
      parentObservationId: "agent",
      kind: "tool",
      name: "lookup",
      durationMs: 400,
      output: { result: "ok" },
      metadata: { toolCount: 1, toolNames: ["lookup"] },
    }),
  ];
  return {
    id: "trace_1",
    sessionId: "session_1",
    name: "support-run",
    status: "success",
    startedAt: "2026-06-20T12:00:00Z",
    endedAt: "2026-06-20T12:00:01.200Z",
    durationMs: 1200,
    input: { prompt: "Hello" },
    output: "Done",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
      totalTokens: 30,
    },
    metadata: { agentId: "support", messages: [{}, {}] },
    observationCount: observations.length,
    observations,
    ...overrides,
  };
}

function observation(overrides: Partial<StudioTraceObservation> = {}): StudioTraceObservation {
  return {
    id: "observation",
    kind: "generation",
    name: "generate",
    status: "success",
    turn: 1,
    startedAt: "2026-06-20T12:00:00Z",
    endedAt: "2026-06-20T12:00:01Z",
    ...overrides,
  };
}
