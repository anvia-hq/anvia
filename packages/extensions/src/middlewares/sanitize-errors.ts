import type { JsonValue, Message, ToolResultOutput } from "@anvia/core/completion";
import { type AgentMiddleware, createMiddleware } from "@anvia/core/tool";
import { truncateText } from "../internal/truncate";

export type SanitizeToolErrorsOptions = {
  /** Strip JavaScript/Node stack trace lines (`at ...`). Default true. */
  stripStackTraces?: boolean | undefined;
  /** Replace absolute filesystem paths with `pathReplacement`. Default true. */
  stripAbsolutePaths?: boolean | undefined;
  /** Replacement token for stripped absolute paths. Default `"[path]"`. */
  pathReplacement?: string | undefined;
  /** Maximum characters kept per error message. Default 1_000. */
  maxChars?: number | undefined;
  /** Fallback text when sanitization leaves an empty `error-text`. Default `"Tool execution failed."`. */
  fallbackMessage?: string | undefined;
};

const STACK_LINE_PATTERN = /^\s+at\s+(?:.+\([^)]*\)|[^\s]+:\d+(?::\d+)?|<anonymous>)\s*$/;
const POSIX_ABS_PATH_PATTERN =
  /(^|[\s("'`=:]|file:\/\/)(\/(?:Users|home|var|tmp|private|etc|opt|srv|Volumes|mnt|root|app|workspace|workspaces)\/[^\s"'`):,]+)/g;
const WINDOWS_ABS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'`):,]+/g;

export function sanitizeToolErrors(options: SanitizeToolErrorsOptions = {}): AgentMiddleware {
  const stripStackTraces = options.stripStackTraces ?? true;
  const stripAbsolutePaths = options.stripAbsolutePaths ?? true;
  const pathReplacement = options.pathReplacement ?? "[path]";
  const maxChars = options.maxChars ?? 1_000;
  const fallbackMessage = options.fallbackMessage ?? "Tool execution failed.";

  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("sanitizeToolErrors maxChars must be a positive safe integer.");
  }

  const sanitizeText = (raw: string, allowEmpty: boolean): string => {
    let text = raw;

    if (stripStackTraces) {
      text = text
        .split(/\r?\n/)
        .filter((line) => !STACK_LINE_PATTERN.test(line))
        .join("\n");
    }

    if (stripAbsolutePaths) {
      text = text.replace(
        POSIX_ABS_PATH_PATTERN,
        (_match, prefix: string) => `${prefix}${pathReplacement}`,
      );
      text = text.replace(WINDOWS_ABS_PATH_PATTERN, () => pathReplacement);
    }

    text = text.trim();

    if (text.length === 0) {
      return allowEmpty ? "" : fallbackMessage;
    }

    return truncateText(text, maxChars).text;
  };

  const sanitizeJsonValue = (value: JsonValue): { value: JsonValue; changed: boolean } => {
    if (typeof value === "string") {
      const next = sanitizeText(value, true);
      return next === value ? { value, changed: false } : { value: next, changed: true };
    }

    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const res = sanitizeJsonValue(item);

        if (res.changed) changed = true;

        return res.value;
      });
      return changed ? { value: next, changed: true } : { value, changed: false };
    }

    if (value !== null && typeof value === "object") {
      let changed = false;
      const next: Record<string, JsonValue> = {};

      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) {
          const res = sanitizeJsonValue(item);

          if (res.changed) changed = true;

          next[key] = res.value;
        }
      }

      return changed ? { value: next, changed: true } : { value, changed: false };
    }

    return { value, changed: false };
  };

  const sanitizeOutput = (output: ToolResultOutput): ToolResultOutput => {
    if (output.type === "error-text") {
      const next = sanitizeText(output.value, false);
      return next === output.value ? output : { ...output, value: next };
    }

    if (output.type === "error-json") {
      const res = sanitizeJsonValue(output.value);
      return res.changed ? { ...output, value: res.value } : output;
    }

    return output;
  };

  return createMiddleware({
    onCompletionRequest(args) {
      let changed = false;
      const nextHistory: Message[] = args.request.chatHistory.map((message) => {
        if (message.role !== "tool") return message;

        let messageChanged = false;
        const nextContent = message.content.map((part) => {
          if (part.type !== "tool-result") return part;

          const nextOutput = sanitizeOutput(part.output);

          if (nextOutput !== part.output) {
            messageChanged = true;
            return { ...part, output: nextOutput };
          }

          return part;
        });

        if (!messageChanged) return message;

        changed = true;
        return { ...message, content: nextContent };
      });

      if (!changed) return undefined;

      return {
        request: {
          ...args.request,
          chatHistory: nextHistory,
        },
      };
    },
  });
}
