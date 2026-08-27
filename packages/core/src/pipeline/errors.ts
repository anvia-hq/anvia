import type { AgentInteractionOutcome } from "../agent/run-types";

export class PipelineAgentSuspensionError extends Error {
  constructor(readonly result: AgentInteractionOutcome) {
    super("Pipeline agent stage suspended for human interaction.");
    this.name = "PipelineAgentSuspensionError";
  }
}

export type PipelineObserverFailure = {
  readonly observer: string;
  readonly error: unknown;
};

export class PipelineObserverDispatchError extends AggregateError {
  readonly phase: string;
  readonly failures: readonly PipelineObserverFailure[];

  constructor(phase: string, failures: readonly PipelineObserverFailure[]) {
    super(
      failures.map((failure) => failure.error),
      `Pipeline observer ${phase} failed for ${failures
        .map((failure) => failure.observer)
        .join(", ")}.`,
    );
    this.name = "PipelineObserverDispatchError";
    this.phase = phase;
    this.failures = Object.freeze([...failures]);
  }
}
