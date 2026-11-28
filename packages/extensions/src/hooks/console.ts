import type { AgentLifecycle } from "@anvia/core/agent";

export type ConsoleHookOptions = {
  /** Prefix added to every log line. Default `"[anvia]"`. */
  prefix?: string | undefined;
  /** Log tool arguments on tool start. Default false. */
  logToolInput?: boolean | undefined;
  /** Log tool outputs on tool finish. Default false. */
  logToolOutput?: boolean | undefined;
  /** Custom line writer (defaults to `console.log`). */
  writer?: ((line: string) => void) | undefined;
};

export function consoleHook<Output = unknown, RawResponse = unknown>(
  options: ConsoleHookOptions = {},
): AgentLifecycle<Output, RawResponse> {
  const prefix = options.prefix ?? "[anvia]";
  const write = options.writer ?? ((line: string) => console.log(line));
  const logToolInput = options.logToolInput ?? false;
  const logToolOutput = options.logToolOutput ?? false;

  return {
    onStart(event) {
      write(`${prefix} run=${event.runId} start maxTurns=${event.maxTurns}`);
    },
    onStepFinish(event) {
      write(
        `${prefix} run=${event.runId} step=${event.step} finish tokens=${event.usage.totalTokens}`,
      );
    },
    onToolStart(event) {
      const detail = logToolInput ? ` input=${safeJson(event.input)}` : "";
      write(
        `${prefix} run=${event.runId} step=${event.step} tool=${event.toolName} start${detail}`,
      );
    },
    onToolFinish(event) {
      const status = event.success ? "ok" : "error";
      let detail = "";

      if (event.success && logToolOutput) {
        detail = ` output=${safeJson(event.output)}`;
      } else if (!event.success) {
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        detail = ` error=${message}`;
      }

      write(
        `${prefix} run=${event.runId} step=${event.step} tool=${event.toolName} ${status} (${event.durationMs}ms)${detail}`,
      );
    },
    onFinish(event) {
      write(
        `${prefix} run=${event.runId} finish status=${event.status} tokens=${event.usage.totalTokens}`,
      );
    },
    onError(event) {
      const message = event.error instanceof Error ? event.error.message : String(event.error);
      write(`${prefix} run=${event.runId} error message=${message}`);
    },
  };
}

function safeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) return "undefined";

    return serialized.length > 200 ? `${serialized.slice(0, 200)}...` : serialized;
  } catch {
    return "[unserializable]";
  }
}
