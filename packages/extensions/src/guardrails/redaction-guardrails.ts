import {
  allow,
  block,
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
  type GuardrailMode,
  type GuardrailPolicy,
  type InputGuardrail,
  type OutputGuardrail,
} from "@anvia/core/guardrails";
import { DEFAULT_PATTERNS, type RedactionPattern } from "@anvia/core/redaction";
import {
  compilePatterns,
  hasCompiledPatternMatch,
  redactStringWithCompiledPatterns,
} from "../internal/pattern-redaction";

export type GuardrailBoundarySelection = "input" | "output" | "both";
export type PatternGuardrailAction = "block" | "redact";

export type PatternGuardrailOptions = {
  id?: string | undefined;
  /** Which boundary to guard. Defaults to `"both"` for PII and `"output"` for secrets. */
  boundary?: GuardrailBoundarySelection | undefined;
  /** Whether a match blocks or redacts the text. */
  action?: PatternGuardrailAction | undefined;
  /** Policy mode (`"enforce"` or `"observe"`). Default `"enforce"`. */
  mode?: GuardrailMode | undefined;
  /** Optional custom redaction patterns; defaults to the built-in pattern set. */
  patterns?: readonly RedactionPattern[] | undefined;
  /** Replacement token used when `action` is `"redact"`. Defaults to `"[redacted-pii]"` or `"[redacted-secret]"`. */
  replacement?: string | undefined;
  /** Reason recorded on guardrail decisions. */
  reason?: string | undefined;
  /** User-facing message returned when blocked. */
  message?: string | undefined;
};

export const PII_PATTERN_NAMES = ["email", "creditCard", "phone", "ipv4"] as const;

export const SECRET_PATTERN_NAMES = [
  "googleApiKey",
  "githubToken",
  "awsAccessKeyId",
  "awsSecretAccessKey",
  "pemPrivateKey",
  "pemPrivateKeyTruncated",
  "slackToken",
  "jwt",
  "apiKey",
  "bearer",
] as const;

const PII_NAME_SET = new Set<string>(PII_PATTERN_NAMES);
const SECRET_NAME_SET = new Set<string>(SECRET_PATTERN_NAMES);

export const DEFAULT_PII_PATTERNS: readonly RedactionPattern[] = Object.freeze(
  DEFAULT_PATTERNS.filter((pattern) => PII_NAME_SET.has(pattern.name)),
);

export const DEFAULT_SECRET_PATTERNS: readonly RedactionPattern[] = Object.freeze(
  DEFAULT_PATTERNS.filter((pattern) => SECRET_NAME_SET.has(pattern.name)),
);

export type CustomPatternGuardrailOptions = Omit<PatternGuardrailOptions, "patterns"> & {
  /** Custom redaction/detection patterns to enforce (must be non-empty). */
  patterns: readonly RedactionPattern[];
};

export function patternGuardrail(options: CustomPatternGuardrailOptions): GuardrailPolicy {
  if (options.patterns.length === 0) {
    throw new TypeError("patternGuardrail patterns must not be empty.");
  }

  return createPatternPolicy({
    id: options.id ?? "extensions.pattern",
    boundary: options.boundary ?? "both",
    action: options.action ?? "block",
    mode: options.mode ?? "enforce",
    patterns: options.patterns,
    replacement: options.replacement ?? "[redacted]",
    reason: options.reason ?? "Restricted pattern detected",
    message: options.message ?? "Content blocked because it matched a restricted pattern.",
  });
}

export function piiGuardrail(options: PatternGuardrailOptions = {}): GuardrailPolicy {
  return createPatternPolicy({
    id: options.id ?? "extensions.pii",
    boundary: options.boundary ?? "both",
    action: options.action ?? "redact",
    mode: options.mode ?? "enforce",
    patterns: options.patterns ?? DEFAULT_PII_PATTERNS,
    replacement: options.replacement ?? "[redacted-pii]",
    reason: options.reason ?? "PII detected",
    message: options.message ?? "Message blocked because it contains personal information.",
  });
}

export function secretLeakGuardrail(options: PatternGuardrailOptions = {}): GuardrailPolicy {
  return createPatternPolicy({
    id: options.id ?? "extensions.secret-leak",
    boundary: options.boundary ?? "output",
    action: options.action ?? "block",
    mode: options.mode ?? "enforce",
    patterns: options.patterns ?? DEFAULT_SECRET_PATTERNS,
    replacement: options.replacement ?? "[redacted-secret]",
    reason: options.reason ?? "Potential credential or secret detected",
    message: options.message ?? "Response blocked because it contains sensitive credentials.",
  });
}

function createPatternPolicy(config: {
  id: string;
  boundary: GuardrailBoundarySelection;
  action: PatternGuardrailAction;
  mode: GuardrailMode;
  patterns: readonly RedactionPattern[];
  replacement: string;
  reason: string;
  message: string;
}): GuardrailPolicy {
  const compiled = compilePatterns(config.patterns);
  const input: InputGuardrail[] = [];
  const output: OutputGuardrail[] = [];

  if (config.boundary === "input" || config.boundary === "both") {
    input.push(
      defineInputGuardrail({
        id: `${config.id}.input`,
        check(context, actions) {
          if (config.action === "block") {
            return hasCompiledPatternMatch(context.inputText, compiled)
              ? block({ reason: config.reason, message: config.message })
              : allow();
          }

          const redacted = redactStringWithCompiledPatterns(
            context.inputText,
            compiled,
            config.replacement,
          );
          return redacted === context.inputText
            ? allow()
            : actions.rewrite({ inputText: redacted, reason: config.reason });
        },
      }),
    );
  }

  if (config.boundary === "output" || config.boundary === "both") {
    output.push(
      defineOutputGuardrail({
        id: `${config.id}.output`,
        check(context, actions) {
          if (config.action === "block") {
            return hasCompiledPatternMatch(context.outputText, compiled)
              ? block({ reason: config.reason, message: config.message })
              : allow();
          }

          const redacted = redactStringWithCompiledPatterns(
            context.outputText,
            compiled,
            config.replacement,
          );
          return redacted === context.outputText
            ? allow()
            : actions.rewrite({ outputText: redacted, reason: config.reason });
        },
      }),
    );
  }

  return defineGuardrailPolicy({
    id: config.id,
    mode: config.mode,
    input,
    output,
  });
}
