import type { AgentInteractionOutcome } from "../agent/run-types";

export class PipelineAgentSuspensionError extends Error {
  constructor(readonly result: AgentInteractionOutcome) {
    super("Pipeline agent stage suspended for human interaction.");
    this.name = "PipelineAgentSuspensionError";
  }
}
