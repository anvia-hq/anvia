import type { BrowserCapability } from "./types";

export type BrowserErrorCode =
  | "action_timeout"
  | "agent_action_busy"
  | "cancelled"
  | "connection_closed"
  | "connection_timeout"
  | "human_control_conflict"
  | "human_controlled"
  | "invalid_state"
  | "lifecycle_timeout"
  | "navigation_blocked"
  | "not_ready"
  | "readiness_timeout"
  | "runtime_destroyed"
  | "startup_failed"
  | "tool_failed"
  | "transport_failure";

export type BrowserErrorRecovery = "none" | "retry" | "reconnect" | "restart" | "recreate";

export type BrowserErrorOptions = ErrorOptions &
  Readonly<{
    retryable?: boolean;
    recovery?: BrowserErrorRecovery;
    capability?: BrowserCapability;
    phase?: string;
  }>;

const defaults: Record<
  BrowserErrorCode,
  Readonly<{ retryable: boolean; recovery: BrowserErrorRecovery }>
> = {
  action_timeout: { retryable: true, recovery: "retry" },
  agent_action_busy: { retryable: true, recovery: "retry" },
  cancelled: { retryable: true, recovery: "retry" },
  connection_closed: { retryable: true, recovery: "reconnect" },
  connection_timeout: { retryable: true, recovery: "reconnect" },
  human_control_conflict: { retryable: true, recovery: "retry" },
  human_controlled: { retryable: true, recovery: "retry" },
  invalid_state: { retryable: false, recovery: "none" },
  lifecycle_timeout: { retryable: true, recovery: "retry" },
  navigation_blocked: { retryable: false, recovery: "none" },
  not_ready: { retryable: true, recovery: "retry" },
  readiness_timeout: { retryable: true, recovery: "retry" },
  runtime_destroyed: { retryable: false, recovery: "recreate" },
  startup_failed: { retryable: true, recovery: "recreate" },
  tool_failed: { retryable: true, recovery: "retry" },
  transport_failure: { retryable: true, recovery: "reconnect" },
};

export class BrowserError extends Error {
  readonly retryable: boolean;
  readonly recovery: BrowserErrorRecovery;
  readonly capability: BrowserCapability | undefined;
  readonly phase: string | undefined;

  constructor(
    message: string,
    readonly code: BrowserErrorCode,
    options: BrowserErrorOptions = {},
  ) {
    super(message, options);
    this.name = "BrowserError";
    this.retryable = options.retryable ?? defaults[code].retryable;
    this.recovery = options.recovery ?? defaults[code].recovery;
    this.capability = options.capability;
    this.phase = options.phase;
  }
}

export function cancellationError(reason: unknown, phase: string): BrowserError {
  return new BrowserError("Browser operation was cancelled by the caller.", "cancelled", {
    cause: reason,
    phase,
  });
}
