import type { EvalMetadata } from "./types";

export type EvalOutcome<Score = unknown> =
  | {
      outcome: "pass";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    }
  | {
      outcome: "fail";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    }
  | {
      outcome: "invalid";
      reason: string;
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    };

export const EvalOutcome = {
  pass<Score>(
    score?: Score,
    options: { comment?: string | undefined; metadata?: EvalMetadata | undefined } = {},
  ): EvalOutcome<Score> {
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
    return outcome;
  },

  fail<Score>(
    score?: Score,
    options: { comment?: string | undefined; metadata?: EvalMetadata | undefined } = {},
  ): EvalOutcome<Score> {
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
    return outcome;
  },

  invalid<Score = never>(
    reason: string,
    options: {
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    } = {},
  ): EvalOutcome<Score> {
    const outcome: EvalOutcome<Score> = {
      outcome: "invalid" as const,
      reason,
    };
    if (options.score !== undefined) {
      outcome.score = options.score;
    }
    if (options.comment !== undefined) {
      outcome.comment = options.comment;
    }
    if (options.metadata !== undefined) {
      outcome.metadata = options.metadata;
    }
    return outcome;
  },
};
