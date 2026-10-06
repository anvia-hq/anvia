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
