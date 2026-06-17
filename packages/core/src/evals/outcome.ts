import { compact } from "../internal/compact";
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
    return compact({
      outcome: "pass" as const,
      score,
      comment: options.comment,
      metadata: options.metadata,
    }) as EvalOutcome<Score>;
  },

  fail<Score>(
    score?: Score,
    options: { comment?: string | undefined; metadata?: EvalMetadata | undefined } = {},
  ): EvalOutcome<Score> {
    return compact({
      outcome: "fail" as const,
      score,
      comment: options.comment,
      metadata: options.metadata,
    }) as EvalOutcome<Score>;
  },

  invalid<Score = never>(
    reason: string,
    options: {
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    } = {},
  ): EvalOutcome<Score> {
    return compact({
      outcome: "invalid" as const,
      reason,
      score: options.score,
      comment: options.comment,
      metadata: options.metadata,
    }) as EvalOutcome<Score>;
  },
};
