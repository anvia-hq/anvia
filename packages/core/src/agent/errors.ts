import type { Message } from "../completion/index";
import type { AgentBlockedResult } from "./run-types";

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
    options?: ErrorOptions,
  ) {
    super(`Agent run cancelled: ${reason}`, options);
    this.name = "AgentRunCancelledError";
  }
}

export class AgentRunBlockedError extends Error {
  constructor(readonly result: AgentBlockedResult) {
    super(`Agent run was blocked by an ${result.stage} guardrail.`);
    this.name = "AgentRunBlockedError";
  }
}
