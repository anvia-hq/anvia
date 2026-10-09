import { appendFileSync } from "node:fs";
import { Agent } from "@anvia/core/agent";
import { defineGoal } from "../src/index.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

export function recoveryGoal(log: string, agentId = "researcher") {
  const goal = defineGoal({
    name: "recovery-goal",
    version: 1,
    agentId: "researcher",
    assess: async ({ previous }) => {
      appendFileSync(log, "assess\n");
      return {
        status: previous === null ? "continue" : "complete",
        progressKey: previous === null ? "one" : "two",
        summary: "Verified artifact",
        next: "Continue",
        evidence: ["checked"],
      };
    },
  });
  const agent = new Agent({
    id: agentId,
    maxTurns: 1,
    model: makeAgent(async (request) => (hasToolResult(request) ? done() : toolResponse())).model,
    tools: [
      lookup(async () => {
        appendFileSync(log, "tool\n");
        return "artifact";
      }),
    ],
  });
  return { goal, registration: { agent, version: "1", toolRecovery: { lookup: "safe" as const } } };
}
