import type { RedactionPattern } from "@anvia/core/redaction";

type CompiledPattern = {
  regex: RegExp;
  validate: RedactionPattern["validate"];
};

export function compilePatterns(patterns: readonly RedactionPattern[]): CompiledPattern[] {
  return patterns.map((pattern) => {
    const flags = pattern.regex.flags.includes("g")
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    return {
      regex: new RegExp(pattern.regex.source, flags),
      validate: pattern.validate,
    };
  });
}

export function hasCompiledPatternMatch(
  text: string,
  compiled: readonly CompiledPattern[],
): boolean {
  for (const pattern of compiled) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.regex.lastIndex += 1;
        continue;
      }

      if (pattern.validate === undefined || pattern.validate(match[0], match.index, text)) {
        pattern.regex.lastIndex = 0;
        return true;
      }
    }

    pattern.regex.lastIndex = 0;
  }

  return false;
}

export function redactStringWithCompiledPatterns(
  text: string,
  compiled: readonly CompiledPattern[],
  replacement: string,
): string {
  let current = text;

  for (const pattern of compiled) {
    pattern.regex.lastIndex = 0;
    current = current.replace(pattern.regex, (...args: unknown[]) => {
      const match = String(args[0]);
      const hasGroups = typeof args[args.length - 1] === "object";
      const offset = Number(args[args.length - (hasGroups ? 3 : 2)]);
      const source = String(args[args.length - (hasGroups ? 2 : 1)]);
      return pattern.validate === undefined || pattern.validate(match, offset, source)
        ? replacement
        : match;
    });
    pattern.regex.lastIndex = 0;
  }

  return current;
}
