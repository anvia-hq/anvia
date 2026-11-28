import type { AgentLifecycle } from "@anvia/core/agent";
import type { Usage } from "@anvia/core/completion";

export type AuditEventType =
  | "run.start"
  | "step.finish"
  | "tool.start"
  | "tool.finish"
  | "run.finish"
  | "run.error";

export type AuditEvent =
  | {
      type: "run.start";
      timestamp: string;
      runId: string;
      maxTurns: number;
      historyLength: number;
    }
  | {
      type: "step.finish";
      timestamp: string;
      runId: string;
      step: number;
      usage: Usage;
    }
  | {
      type: "tool.start";
      timestamp: string;
      runId: string;
      step: number;
      toolName: string;
      toolCallId?: string | undefined;
      input?: unknown;
    }
  | {
      type: "tool.finish";
      timestamp: string;
      runId: string;
      step: number;
      toolName: string;
      toolCallId?: string | undefined;
      durationMs: number;
      success: boolean;
      output?: unknown;
      error?: string | undefined;
    }
  | {
      type: "run.finish";
      timestamp: string;
      runId: string;
      status: "completed" | "blocked" | "suspended";
      usage: Usage;
    }
  | {
      type: "run.error";
      timestamp: string;
      runId: string;
      error: string;
      usage: Usage;
    };

export type AuditHookOptions = {
  onEvent(event: AuditEvent): void | Promise<void>;
  /** Include tool input payloads in audit events. Default false (privacy-safe). */
  includeToolInput?: boolean | undefined;
  /** Include tool output payloads in audit events. Default false (privacy-safe). */
  includeToolOutput?: boolean | undefined;
  /** Custom clock for deterministic testing. Default `() => new Date().toISOString()`. */
  timestamp?: (() => string) | undefined;
};

export function auditHook<Output = unknown, RawResponse = unknown>(
  options: AuditHookOptions,
): AgentLifecycle<Output, RawResponse> {
  const getTimestamp = options.timestamp ?? (() => new Date().toISOString());
  const includeToolInput = options.includeToolInput ?? false;
  const includeToolOutput = options.includeToolOutput ?? false;

  return {
    async onStart(event) {
      await options.onEvent({
        type: "run.start",
        timestamp: getTimestamp(),
        runId: event.runId,
        maxTurns: event.maxTurns,
        historyLength: event.history.length,
      });
    },
    async onStepFinish(event) {
      await options.onEvent({
        type: "step.finish",
        timestamp: getTimestamp(),
        runId: event.runId,
        step: event.step,
        usage: { ...event.usage },
      });
    },
    async onToolStart(event) {
      const record: Extract<AuditEvent, { type: "tool.start" }> = {
        type: "tool.start",
        timestamp: getTimestamp(),
        runId: event.runId,
        step: event.step,
        toolName: event.toolName,
      };

      if (event.toolCallId !== undefined) record.toolCallId = event.toolCallId;

      if (includeToolInput) record.input = event.input;

      await options.onEvent(record);
    },
    async onToolFinish(event) {
      const record: Extract<AuditEvent, { type: "tool.finish" }> = {
        type: "tool.finish",
        timestamp: getTimestamp(),
        runId: event.runId,
        step: event.step,
        toolName: event.toolName,
        durationMs: event.durationMs,
        success: event.success,
      };

      if (event.toolCallId !== undefined) record.toolCallId = event.toolCallId;

      if (event.success && includeToolOutput) record.output = event.output;

      if (!event.success) record.error = formatError(event.error);

      await options.onEvent(record);
    },
    async onFinish(event) {
      await options.onEvent({
        type: "run.finish",
        timestamp: getTimestamp(),
        runId: event.runId,
        status: event.status,
        usage: { ...event.usage },
      });
    },
    async onError(event) {
      await options.onEvent({
        type: "run.error",
        timestamp: getTimestamp(),
        runId: event.runId,
        error: formatError(event.error),
        usage: { ...event.usage },
      });
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
