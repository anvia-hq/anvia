import type { Usage } from "../completion";
import type { EvalInvalidKind, EvalMetadata } from "./types";

type EvalOutcomeOptions = {
  comment?: string | undefined;
  metadata?: EvalMetadata | undefined;
  usage?: Usage | undefined;
};

export type EvalOutcome<Score = unknown> =
  | {
      outcome: "pass";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
      usage?: Usage | undefined;
    }
  | {
      outcome: "fail";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
      usage?: Usage | undefined;
    }
  | {
      outcome: "invalid";
      reason: string;
      kind?: EvalInvalidKind | undefined;
      error?: unknown;
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
      usage?: Usage | undefined;
    };

export const EvalOutcome = {
  pass<Score>(score?: Score, options: EvalOutcomeOptions = {}): EvalOutcome<Score> {
    const outcome: EvalOutcome<Score> = {
      outcome: "pass" as const,
    };
    if (score !== undefined) {
      outcome.score = score;
    }
    if (options.comment !== undefined) {
      outcome.comment = options.comment;
    }
    if (options.metadata !== undefined) {
      outcome.metadata = options.metadata;
    }
    if (options.usage !== undefined) {
      outcome.usage = options.usage;
    }
    return outcome;
  },

  fail<Score>(score?: Score, options: EvalOutcomeOptions = {}): EvalOutcome<Score> {
    const outcome: EvalOutcome<Score> = {
      outcome: "fail" as const,
    };
    if (score !== undefined) {
      outcome.score = score;
    }
    if (options.comment !== undefined) {
      outcome.comment = options.comment;
    }
    if (options.metadata !== undefined) {
      outcome.metadata = options.metadata;
    }
    if (options.usage !== undefined) {
      outcome.usage = options.usage;
    }
    return outcome;
  },

  invalid<Score = never>(
    reason: string,
    options: EvalOutcomeOptions & {
      score?: Score | undefined;
      kind?: EvalInvalidKind | undefined;
      error?: unknown;
    } = {},
  ): EvalOutcome<Score> {
    const outcome: EvalOutcome<Score> = {
      outcome: "invalid" as const,
      reason,
    };
    if (options.score !== undefined) {
      outcome.score = options.score;
    }
    if (options.comment !== undefined) outcome.comment = options.comment;
    if (options.metadata !== undefined) outcome.metadata = options.metadata;
    if (options.usage !== undefined) outcome.usage = options.usage;
    if (options.kind !== undefined) outcome.kind = options.kind;
    if (options.error !== undefined) outcome.error = options.error;
    return outcome;
  },

  fromError(error: unknown, kind: EvalInvalidKind = "metric"): EvalOutcome<never> {
    const reason = error instanceof Error ? error.message : String(error);
    return EvalOutcome.invalid(reason, { kind, error });
  },
};
