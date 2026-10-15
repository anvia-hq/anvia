import type { PipelineGraphNode } from "@anvia/core/pipeline";
import { describe, expect, it } from "vitest";
import { pipelineStageLog } from "../src/runtime/pipeline-logs";

function startedLog(node: PipelineGraphNode) {
  return pipelineStageLog({
    type: "stage_started",
    runId: "run_1",
    pipelineId: "triage",
    path: node.path,
    node,
  });
}

describe("pipeline stage logs", () => {
  it("categorizes decision, route, and branch stages by their owning stage", () => {
    const node = (overrides: Partial<PipelineGraphNode>): PipelineGraphNode => ({
      id: "stage",
      path: ["stage"],
      kind: "step",
      label: "Stage",
      ...overrides,
    });

    expect(startedLog(node({ kind: "decision" })).category).toBe("decision");
    expect(startedLog(node({ kind: "route" })).category).toBe("decision");
    expect(startedLog(node({ kind: "parallel" })).category).toBe("parallel");
    expect(
      startedLog(node({ kind: "branch", branchKey: "billing", branchOf: "route" })),
    ).toMatchObject({
      category: "decision",
      metadata: { branchKey: "billing", branchOf: "route" },
    });
    expect(
      startedLog(node({ kind: "branch", branchKey: "left", branchOf: "parallel" })).category,
    ).toBe("parallel");
    expect(startedLog(node({ kind: "branch", branchKey: "legacy" })).category).toBe("parallel");
  });
});
