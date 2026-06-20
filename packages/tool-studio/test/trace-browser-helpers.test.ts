import { describe, expect, it } from "vitest";
import type { StudioTrace, StudioTraceObservation } from "../src/types";
import {
  compactTraceMetadata,
  firstDeltaMsFromObservations,
  observationDetailMetadata,
  observationStatusSummary,
  observationUsageText,
  plainTraceValue,
  selectedTraceDetail,
  traceDetailMetadata,
  traceObservationLabel,
  traceObservationTree,
  traceTurns,
  turnUsageText,
} from "../src/ui/app/modules/tracing/trace-browser";

describe("trace browser helper behavior", () => {
  it("groups observations into sorted turns and builds parent-child trees", () => {
    const observations = [
      observation({ id: "child", parentObservationId: "root", turn: 2, durationMs: 20 }),
      observation({ id: "root", kind: "agent", name: "agent.run", turn: 2, durationMs: 30 }),
      observation({ id: "first", turn: 1, durationMs: 5 }),
    ];

    expect(
      traceTurns(trace({ observations })).map(({ turn, durationMs }) => ({ turn, durationMs })),
    ).toEqual([
      { turn: 1, durationMs: 5 },
      { turn: 2, durationMs: 50 },
    ]);

    const tree = traceObservationTree(observations);
    expect(tree.map((node) => node.observation.id)).toEqual(["root", "first"]);
    expect(tree[0]?.children.map((node) => node.observation.id)).toEqual(["child"]);
  });

  it("selects trace, agent, turn, and observation detail records", () => {
    const observations = [
      observation({
        id: "gen",
        kind: "generation",
        name: "model.generate",
        turn: 1,
        input: { prompt: "Hello" },
        output: { choice: [{ type: "text", text: "Hi" }], usage: usage(3, 4) },
        metadata: { firstDeltaMs: 12, provider: "test", model: "alpha", messageId: "msg_1" },
      }),
      observation({
        id: "tool",
        kind: "tool",
        name: "lookup",
        turn: 1,
        output: { usage: usage(1, 2), result: "ok" },
        metadata: { toolCount: 1, toolNames: ["lookup"], resultBytes: 2 },
      }),
    ];
    const subject = trace({
      name: "support-run",
      input: { prompt: "Hello" },
      output: "Done",
      usage: usage(10, 20),
      metadata: { agentId: "support", messages: [{}, {}] },
      observations,
    });
    const turns = traceTurns(subject);

    expect(selectedTraceDetail(subject, turns, "trace")).toMatchObject({
      title: "support-run",
      tone: "trace",
      firstDeltaMs: 12,
      usage: "30 tok",
      output: "Done",
    });
    expect(selectedTraceDetail(subject, turns, "agent")).toMatchObject({
      title: "agent.run",
      tone: "agent",
      usage: "30 tok",
    });
    expect(selectedTraceDetail(subject, turns, "turn:1")).toMatchObject({
      title: "turn.1",
      tone: "turn",
      firstDeltaMs: 12,
      input: { prompt: "Hello" },
    });
    expect(selectedTraceDetail(subject, turns, "observation:tool")).toMatchObject({
      title: "tool.lookup",
      tone: "tool",
    });
    expect(selectedTraceDetail(subject, turns, "observation:missing")).toMatchObject({
      title: "support-run",
      tone: "trace",
    });
  });

  it("creates compact trace and observation metadata groups", () => {
    const subject = trace({
      trace: { traceId: "external_trace", observationId: "root_observation" },
      durationMs: 100,
      endedAt: "2026-06-20T12:00:01.000Z",
      metadata: { messages: [{}, {}], custom: true },
      observations: [],
    });

    expect(traceDetailMetadata(subject)).toMatchObject({
      custom: true,
      traceId: "external_trace",
      observationId: "root_observation",
      messageCount: 2,
      trace: {
        status: "success",
        traceId: "external_trace",
        observationId: "root_observation",
        messageCount: 2,
      },
    });

    expect(
      observationDetailMetadata(
        observation({
          kind: "generation",
          parentObservationId: "parent",
          endedAt: "2026-06-20T12:00:02.000Z",
          durationMs: 250,
          metadata: {
            provider: "test",
            model: "alpha",
            requestedModel: "alpha-large",
            defaultModel: "alpha",
            historyCount: 3,
            documentCount: 1,
            toolCount: 2,
            toolNames: ["lookup"],
            firstDeltaMs: 25,
            usage: usage(4, 5),
          },
        }),
      ),
    ).toMatchObject({
      status: "success",
      kind: "generation",
      parentObservationId: "parent",
      modelInfo: { provider: "test", model: "alpha", requestedModel: "alpha-large" },
      modelCall: { request: { messageCount: 3, documentCount: 1, toolCount: 2 } },
      response: { usage: usage(4, 5) },
      tools: { count: 2, names: ["lookup"] },
      timing: { firstDeltaMs: 25, durationMs: 250 },
    });

    expect(compactTraceMetadata({ keep: 1, drop: undefined, nil: null })).toEqual({
      keep: 1,
      nil: null,
    });
  });

  it("summarizes statuses, labels, first deltas, and usage", () => {
    expect(observationStatusSummary([])).toBe("empty");
    expect(observationStatusSummary([observation({ status: "running" })])).toBe("running");
    expect(observationStatusSummary([observation({ status: "error" })])).toBe("error");
    expect(observationStatusSummary([observation({ status: "success" })])).toBe("success");
    expect(traceObservationLabel(observation({ kind: "agent", name: "agent.run" }))).toBe(
      "agent.run",
    );
    expect(traceObservationLabel(observation({ kind: "tool", name: "lookup" }))).toBe(
      "tool.lookup",
    );
    expect(
      firstDeltaMsFromObservations([
        observation({ metadata: {} }),
        observation({ metadata: { firstDeltaMs: 44 } }),
      ]),
    ).toBe(44);
    expect(firstDeltaMsFromObservations([observation({ metadata: { firstDeltaMs: "44" } })])).toBe(
      undefined,
    );

    const generation = observation({ output: { usage: usage(5, 7) } });
    const noUsage = observation({ output: { text: "ok" } });
    expect(observationUsageText(generation)).toContain("5 -> 7");
    expect(observationUsageText(noUsage)).toBe("");
    expect(turnUsageText([generation, observation({ output: { usage: usage(1, 2) } })])).toContain(
      " + ",
    );
  });

  it("formats plain trace values for scalars, objects, arrays, and empty objects", () => {
    expect(plainTraceValue("Input", "hello")).toEqual([{ label: "Input", text: "hello" }]);
    expect(plainTraceValue("Metadata", null)).toEqual([{ label: "Metadata", text: "null" }]);
    expect(plainTraceValue("Metadata", {})).toEqual([{ label: "Metadata", text: "Empty object" }]);
    expect(
      plainTraceValue("Output", {
        choice: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
        ],
      }),
    ).toEqual([
      { label: "Reasoning", text: "thinking" },
      { label: "Assistant output", text: "answer" },
    ]);
    expect(plainTraceValue("Items", [{ type: "tool_result", content: [{ text: "ok" }] }])).toEqual([
      { label: "Tool Result", text: "ok" },
    ]);
    expect(plainTraceValue("Prompt", { prompt: [{ role: "user", content: "Hi" }] })).toEqual([
      { label: "User", text: "Hi" },
    ]);
  });
});

function trace(overrides: Partial<StudioTrace> = {}): StudioTrace {
  const observations = overrides.observations ?? [];
  return {
    id: "trace_1",
    sessionId: "session_1",
    name: "trace.name",
    status: "success",
    startedAt: "2026-06-20T12:00:00.000Z",
    observationCount: observations.length,
    observations,
    ...overrides,
  };
}

function observation(overrides: Partial<StudioTraceObservation> = {}): StudioTraceObservation {
  return {
    id: "obs_1",
    kind: "generation",
    name: "generate",
    status: "success",
    turn: 1,
    startedAt: "2026-06-20T12:00:00.000Z",
    ...overrides,
  };
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
