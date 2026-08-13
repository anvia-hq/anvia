import type { Message } from "../completion/index";
import type { ToolApprovalRequest } from "../tool";

export class MaxTurnsError extends Error {
  constructor(
    readonly maxTurns: number,
    readonly chatHistory: Message[],
    readonly prompt: Message,
  ) {
    super(`Reached max turn limit: ${maxTurns}`);
    this.name = "MaxTurnsError";
  }
}

export class AgentRunCancelledError extends Error {
  constructor(
    readonly chatHistory: Message[],
    readonly reason: string,
  ) {
    super(`Agent run cancelled: ${reason}`);
    this.name = "AgentRunCancelledError";
  }
}

export class ToolApprovalRequiredError extends Error {
  constructor(readonly request: ToolApprovalRequest) {
    super(`Tool approval required for ${request.toolName}, but no approval handler is configured.`);
    this.name = "ToolApprovalRequiredError";
  }
}
