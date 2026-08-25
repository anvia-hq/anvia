// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudioConfig, StudioTrace, StudioTraceObservation } from "../src/types";
import { TraceBrowser } from "../src/ui/app/modules/tracing/trace-browser";
import {
  TraceJsonTree,
  TraceToneIcon,
  traceToneIconClass,
} from "../src/ui/app/modules/tracing/trace-browser-detail";

const agents: StudioConfig["agents"] = [{ id: "support", name: "Support", quickPrompts: [] }];

describe("TraceBrowser rendering", () => {
  it("renders the disabled and empty table states", () => {
    const unavailableHtml = render({ tracesEnabled: false });
    expect(unavailableHtml).toContain("Tracing unavailable");
    expect(unavailableHtml).toContain("This Studio runtime does not expose traces.");
    expect(render({ traceLoadState: "loading" })).toContain("Loading traces");
    const emptyHtml = render();
    expect(emptyHtml).toContain("No traces found");
    expect(emptyStateClasses(emptyHtml)).toEqual(expect.arrayContaining(["h-full", "min-h-64"]));
    expect(emptyHtml).not.toContain("First delta");
    expect(emptyHtml).not.toContain("pb-6");
    expect(emptyHtml).not.toContain("pr-6");
  });

  it("renders the trace table with status, agent, and timing summaries", () => {
    const html = render({ traces: [trace()] });

    expect(html).toContain("trace_1");
    expect(html).toContain("session_1");
    expect(html).toContain("Support");
    expect(html).toContain("success");
    expect(html).toContain("border-0 capitalize");
    expect(html).toContain("bg-status-success-fill text-status-success-ink");
    expect(html).not.toContain("h-2.5 w-2.5 shrink-0 rounded-lg");
    expect(html).toContain("1.2s");
    expect(html).toContain("36");
    expect(html).toContain("2");
  });

  it("uses the Studio syntax palette for JSON tokens", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <TraceJsonTree value={{ label: "ready", count: 2, enabled: true, empty: null }} />,
      ),
    );
    const html = container.innerHTML;

    expect(html).toContain("code-keyword");
    expect(html).toContain("code-string");
    expect(html).toContain("code-number");
    expect(html).toContain("code-literal");

    act(() => root.unmount());
  });

  it("falls back safely for unknown runtime trace tones", () => {
    const html = renderToStaticMarkup(<TraceToneIcon tone={"unknown" as never} />);

    expect(html).toContain("svg");
    expect(traceToneIconClass("unknown" as never)).toBe("bg-muted text-muted-foreground");
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
    expect(detailHtml).toContain("Input");
    expect(detailHtml).toContain("Output");
    expect(detailHtml).toContain("Metadata");
    expect(detailHtml).toContain("Search spans");
    expect(detailHtml).toContain("Collapse all spans");
    expect(detailHtml).toContain("Formatted");
    expect(detailHtml).toContain("JSON");
    expect(detailHtml).not.toContain('role="tree"');
    expect(detailHtml).not.toContain('role="treeitem"');
    expect(detailHtml).toContain('aria-current="true"');

    const sessionHtml = render({
      traces: [selected, sibling],
      selectedTraceId: selected.id,
      traceSessionDetailId: selected.sessionId,
    });
    expect(sessionHtml).toContain("follow-up");
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

function emptyStateClasses(html: string): string[] {
  const match = html.match(/data-slot="studio-empty-state" class="([^"]+)"/);
  if (match?.[1] === undefined) {
    throw new Error("Studio empty state class list not found");
  }
  return match[1].split(" ");
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
