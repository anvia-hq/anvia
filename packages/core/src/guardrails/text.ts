import { allow, block } from "./actions";
import { defineInputGuardrail, defineOutputGuardrail } from "./policy";
import type { GuardrailAllow, GuardrailBlock, InputGuardrail, OutputGuardrail } from "./types";

export const guardrails = {
  blockText,
  redactText,
};

type TextPatternBoundary = "input" | "output";

type TextPatternGuardrailFor<Boundary extends TextPatternBoundary> = Boundary extends "input"
  ? InputGuardrail
  : OutputGuardrail;

type TextPatternGuardrailOptions<Boundary extends TextPatternBoundary = TextPatternBoundary> = {
  id: string;
  boundary: Boundary;
  patterns: Array<string | RegExp>;
  reason: string;
  message?: string | undefined;
};

type TextPatternRedactOptions<Boundary extends TextPatternBoundary = TextPatternBoundary> =
  TextPatternGuardrailOptions<Boundary> & { replacement?: string | undefined };

function blockText<Boundary extends TextPatternBoundary>(
  options: TextPatternGuardrailOptions<Boundary>,
): TextPatternGuardrailFor<Boundary> {
  return textPatternGuardrail(options, "block");
}

function redactText<Boundary extends TextPatternBoundary>(
  options: TextPatternRedactOptions<Boundary>,
): TextPatternGuardrailFor<Boundary> {
  return textPatternGuardrail(options, "rewrite");
}

function textPatternGuardrail<Boundary extends TextPatternBoundary>(
  options: TextPatternRedactOptions<Boundary>,
  action: "block" | "rewrite",
): TextPatternGuardrailFor<Boundary> {
  if (options.boundary === "input") {
    return defineInputGuardrail({
      id: options.id,
      check(ctx, actions) {
        return textPatternAction(ctx.inputText, options, action, (value) =>
          actions.rewrite({ inputText: value, reason: options.reason }),
        );
      },
    }) as TextPatternGuardrailFor<Boundary>;
  }
  return defineOutputGuardrail({
    id: options.id,
    check(ctx, actions) {
      return textPatternAction(ctx.outputText, options, action, (value) =>
        actions.rewrite({ outputText: value, reason: options.reason }),
      );
    },
  }) as TextPatternGuardrailFor<Boundary>;
}

function textPatternAction<TRewrite>(
  text: string,
  options: TextPatternGuardrailOptions & { replacement?: string | undefined },
  action: "block" | "rewrite",
  rewrite: (value: string) => TRewrite,
): GuardrailAllow | GuardrailBlock | TRewrite {
  const matched = options.patterns.some((pattern) => textPatternMatches(text, pattern));
  if (!matched) {
    return allow();
  }
  if (action === "block") {
    return block({
      reason: options.reason,
      message: options.message,
    });
  }
  let current = text;
  for (const pattern of options.patterns) {
    current = replaceTextPattern(current, pattern, options.replacement ?? "[redacted]");
  }
  return rewrite(current);
}

function textPatternMatches(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return text.includes(pattern);
  }
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

function replaceTextPattern(text: string, pattern: string | RegExp, replacement: string): string {
  if (typeof pattern === "string") {
    return text.split(pattern).join(replacement);
  }
  pattern.lastIndex = 0;
  const flags = pattern.flags.replace("y", "");
  const globalFlags = flags.includes("g") ? flags : `${flags}g`;
  return text.replace(new RegExp(pattern.source, globalFlags), replacement);
}
