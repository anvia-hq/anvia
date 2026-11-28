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
import { truncateText } from "../internal/truncate";
import type { GuardrailBoundarySelection } from "./redaction-guardrails";

export type LengthGuardrailOptions = {
  id?: string | undefined;
  /** Maximum allowed characters. */
  maxChars: number;
  /** Boundary to check. Default `"input"`. */
  boundary?: GuardrailBoundarySelection | undefined;
  /** Whether to block or truncate text over maxChars. Default `"block"`. */
  action?: "block" | "truncate" | undefined;
  /** Policy mode (`"enforce"` or `"observe"`). Default `"enforce"`. */
  mode?: GuardrailMode | undefined;
  /** Suffix used when `action` is `"truncate"`. */
  suffix?: string | undefined;
  reason?: string | undefined;
  message?: string | undefined;
};

export function lengthGuardrail(options: LengthGuardrailOptions): GuardrailPolicy {
  if (!Number.isSafeInteger(options.maxChars) || options.maxChars <= 0) {
    throw new RangeError("lengthGuardrail maxChars must be a positive safe integer.");
  }

  const id = options.id ?? "extensions.length";
  const boundary = options.boundary ?? "input";
  const action = options.action ?? "block";
  const mode = options.mode ?? "enforce";
  const reason = options.reason ?? `Text exceeds maximum length of ${options.maxChars} characters`;
  const message =
    options.message ??
    `Content exceeds the maximum allowed length of ${options.maxChars} characters.`;

  const input: InputGuardrail[] = [];
  const output: OutputGuardrail[] = [];

  if (boundary === "input" || boundary === "both") {
    input.push(
      defineInputGuardrail({
        id: `${id}.input`,
        check(context, actions) {
          if (context.inputText.length <= options.maxChars) {
            return allow();
          }

          if (action === "block") {
            return block({ reason, message });
          }

          const { text } = truncateText(context.inputText, options.maxChars, options.suffix);
          return actions.rewrite({ inputText: text, reason });
        },
      }),
    );
  }

  if (boundary === "output" || boundary === "both") {
    output.push(
      defineOutputGuardrail({
        id: `${id}.output`,
        check(context, actions) {
          if (context.outputText.length <= options.maxChars) {
            return allow();
          }

          if (action === "block") {
            return block({ reason, message });
          }

          const { text } = truncateText(context.outputText, options.maxChars, options.suffix);
          return actions.rewrite({ outputText: text, reason });
        },
      }),
    );
  }

  return defineGuardrailPolicy({ id, mode, input, output });
}
