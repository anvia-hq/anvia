import type { AgentToolApprovalRequest } from "../../agent/run-types";
import type { ToolApprovalRequest } from "./approval-request";

const approvalDetails = new WeakMap<object, ToolApprovalRequest>();

export function registerAgentApprovalRequestDetails(
  approval: AgentToolApprovalRequest,
  request: ToolApprovalRequest,
): void {
  approvalDetails.set(approval, request);
}

export function getAgentApprovalRequestDetails(
  approval: AgentToolApprovalRequest,
): ToolApprovalRequest | undefined {
  return approvalDetails.get(approval);
}
