import type { Usage } from "../completion";
import { errorHttpStatusCode } from "../retry";
import type { EvalInvalidKind, EvalMetadata } from "./types";

const PROVIDER_ERROR_NAMES = new Set([
  "APIError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "ApiError",
  "AuthenticationError",
  "BadRequestError",
  "CompletionProviderOutputError",
  "ConflictError",
  "InternalServerError",
  "NotFoundError",
  "PermissionDeniedError",
  "RateLimitError",
  "SDKError",
  "UnprocessableEntityError",
]);

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

  fromError(error: unknown, kind?: EvalInvalidKind): EvalOutcome<never> {
    const resolvedKind = kind ?? inferEvalInvalidKind(error);
    const reason = formatEvalErrorReason(error);
    return EvalOutcome.invalid(reason, { kind: resolvedKind, error });
  },
};

function formatEvalErrorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const primary = error.message.trim();
  const causeMessage = directCauseMessage(error);

  if (causeMessage === undefined) return error.message;

  if (primary.length === 0) return causeMessage;

  if (primary.includes(causeMessage)) return error.message;

  return `${primary}: ${causeMessage}`;
}

function directCauseMessage(error: Error): string | undefined {
  const cause = (error as { cause?: unknown }).cause;

  if (cause instanceof Error) {
    const message = cause.message.trim();
    return message.length > 0 ? message : undefined;
  }

  if (typeof cause === "string") {
    const message = cause.trim();
    return message.length > 0 ? message : undefined;
  }

  return undefined;
}

function inferEvalInvalidKind(error: unknown): EvalInvalidKind {
  const seen = new Set<object>();
  let current: unknown = error;
  let isProvider = false;
  let isConfiguration = false;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const name = readStringProperty(current as Record<string, unknown>, "name");

    if (name === "EvalTimeoutError") return "timeout";

    if (name === "CompletionCapabilityError") isConfiguration = true;

    if (name !== undefined && PROVIDER_ERROR_NAMES.has(name)) isProvider = true;

    current = readProperty(current as Record<string, unknown>, "cause");
  }

  const statusCode = errorHttpStatusCode(error);

  if (isProvider || (statusCode !== undefined && statusCode >= 400 && statusCode <= 599)) {
    return "provider";
  }

  if (isConfiguration) return "configuration";

  return "metric";
}

function readStringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = readProperty(value, key);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function readProperty(value: Record<string, unknown>, key: string): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}
