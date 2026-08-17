import type { AgentSuspendedResult } from "../agent/run-types";

export class PipelineAgentSuspensionError extends Error {
  constructor(readonly result: AgentSuspendedResult) {
    super("Pipeline agent stage suspended for human interaction.");
    this.name = "PipelineAgentSuspensionError";
  }
}
