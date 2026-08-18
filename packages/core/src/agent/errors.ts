import type { Message, Usage } from "../completion/index";
import type { AgentBlockedResult, AgentSuspendedResult } from "./run-types";

export type AgentStructuredOutputPhase = "parse" | "schema";

export type AgentStructuredOutputFormat = "raw" | "json-fence" | "unlabeled-fence";

export class AgentStructuredOutputError extends Error {
  readonly phase: AgentStructuredOutputPhase;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly outputLength: number;
  readonly normalizedLength: number;
  readonly outputFormat: AgentStructuredOutputFormat;
  readonly usage: Usage;

  constructor(options: {
    phase: AgentStructuredOutputPhase;
    attempt: number;
    maxAttempts: number;
    outputLength: number;
    normalizedLength: number;
    outputFormat: AgentStructuredOutputFormat;
    usage: Usage;
    cause: unknown;
  }) {
    const failure = options.phase === "parse" ? "JSON parsing" : "schema validation";
    super(
      `Agent structured output failed ${failure} on attempt ${options.attempt} of ${options.maxAttempts}.`,
      { cause: options.cause },
    );
    this.name = "AgentStructuredOutputError";
    this.phase = options.phase;
    this.attempt = options.attempt;
    this.maxAttempts = options.maxAttempts;
    this.outputLength = options.outputLength;
    this.normalizedLength = options.normalizedLength;
    this.outputFormat = options.outputFormat;
    this.usage = options.usage;
  }
}

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

export class AgentStreamClosedError extends Error {
  constructor() {
    super("Agent stream is no longer accepting steering input.");
    this.name = "AgentStreamClosedError";
  }
}

export class AgentToolSuspensionError extends Error {
  constructor(readonly result: AgentSuspendedResult) {
    super("Agent tool execution suspended for human interaction.");
    this.name = "AgentToolSuspensionError";
  }
}
