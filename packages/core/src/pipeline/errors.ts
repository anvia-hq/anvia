import type { AgentApprovalRequiredResult } from "../agent/run-types";

export class PipelineAgentApprovalError extends Error {
  constructor(readonly result: AgentApprovalRequiredResult) {
    super("Pipeline agent stage required tool approval and was rejected.");
    this.name = "PipelineAgentApprovalError";
  }
}
