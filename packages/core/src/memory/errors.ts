import type { Usage } from "../completion/types";

export class MemoryCompactionError extends Error {
  readonly usage: Usage | undefined;

  constructor(message: string, options: ErrorOptions & { usage?: Usage | undefined } = {}) {
    super(message, options);
    this.name = "MemoryCompactionError";
    this.usage = options.usage;
  }
}

export class MemoryCompactionConflictError extends MemoryCompactionError {
  constructor(attempts: number, usage?: Usage) {
    super(`Memory compaction could not commit after ${attempts} concurrent update attempts.`, {
      usage,
    });
    this.name = "MemoryCompactionConflictError";
  }
}
