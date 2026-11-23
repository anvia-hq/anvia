export const COMPLETION_PROVIDER_OUTPUT_ERROR_CODE = "ANVIA_COMPLETION_PROVIDER_OUTPUT" as const;

export type CompletionProviderOutputErrorKind =
  | "malformed-tool-arguments"
  | "invalid-tool-arguments"
  | "invalid-stream-event"
  | "invalid-response"
  | "incomplete-stream"
  | "incomplete-tool-call"
  | "invalid-tool-call"
  | "truncated-tool-call"
  | "filtered-tool-call";

export const RETRYABLE_PROVIDER_OUTPUT_KINDS: ReadonlySet<string> = new Set([
  "malformed-tool-arguments",
  "invalid-tool-arguments",
  "invalid-stream-event",
  "incomplete-stream",
  "incomplete-tool-call",
  "invalid-tool-call",
  "truncated-tool-call",
]);

export const PROVIDER_OUTPUT_ERROR_KINDS: ReadonlySet<CompletionProviderOutputErrorKind> =
  new Set<CompletionProviderOutputErrorKind>([
    "malformed-tool-arguments",
    "invalid-tool-arguments",
    "invalid-stream-event",
    "invalid-response",
    "incomplete-stream",
    "incomplete-tool-call",
    "invalid-tool-call",
    "truncated-tool-call",
    "filtered-tool-call",
  ]);

export const PROVIDER_OUTPUT_FINISH_REASONS: ReadonlySet<string> = new Set([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "other",
]);

export const RETRYABLE_STRUCTURED_OUTPUT_PHASES: ReadonlySet<string> = new Set([
  "truncated",
  "parse",
  "schema",
]);
