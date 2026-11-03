export class DurableRecoveryError extends Error {
  constructor(
    message: string,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "DurableRecoveryError";
  }
}

export class DurableRunError extends Error {
  constructor(
    readonly runId: string,
    readonly status: "failed" | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "DurableRunError";
  }
}

export class DurableNotFoundError extends Error {}
export class DurableConflictError extends Error {}

/** Internal marker for errors within core completion, excluding journal and tool failures. */
export class DurableModelError extends Error {
  constructor(
    readonly operationId: string,
    readonly attempts: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** Fatal journal failure; application retries cannot repair a poisoned runtime. */
export class DurableStorageError extends Error {}

export type DurableLimitCode = "payload_too_large" | "capacity_exceeded";

/**
 * Admission rejection. `payload_too_large` can never succeed for the same request;
 * `capacity_exceeded` clears when pending work settles.
 */
export class DurableLimitError extends Error {
  readonly code: DurableLimitCode;
  /** Persisted field that exceeded the limit, such as `run.input`. */
  readonly field: string | undefined;
  /** Configured byte or count budget that rejected the write. */
  readonly limit: number | undefined;
  /** Measured bytes of the rejected value. */
  readonly actual: number | undefined;

  constructor(
    code: DurableLimitCode,
    message: string,
    details: { field?: string; limit?: number; actual?: number } = {},
  ) {
    super(message);
    this.name = "DurableLimitError";
    this.code = code;
    this.field = details.field;
    this.limit = details.limit;
    this.actual = details.actual;
  }
}
