import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentObserver,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunEventArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
  AgentToolSuspendedArgs,
} from "@anvia/core/observability";
import type { LogContext, Logger } from "./types";

export type LoggerObserverOptions = {
  includeOutput?: boolean | undefined;
  includeRequest?: boolean | undefined;
  includeResponse?: boolean | undefined;
  includeToolResult?: boolean | undefined;
};

export function createLoggerObserver(
  options: LoggerObserverOptions & { logger: Logger },
): AgentObserver {
  const { logger, ...observerOptions } = options;
  return {
    startRun(args) {
      return new LoggerRunObserver(logger, observerOptions, args);
    },
  };
}

class LoggerRunObserver implements AgentRunObserver {
  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly options: LoggerObserverOptions,
    args: AgentRunStartArgs,
  ) {
    const context: LogContext = {
      component: "anvia.agent",
      runId: args.runId,
    };
    if (args.agentName !== undefined) context.agentName = args.agentName;
    if (args.trace?.name !== undefined) context.traceName = args.trace.name;
    if (args.trace?.userId !== undefined) context.userId = args.trace.userId;
    if (args.trace?.sessionId !== undefined) context.sessionId = args.trace.sessionId;
    if (args.trace?.traceId !== undefined) context.traceId = args.trace.traceId;
    this.logger = logger.child(context);
    this.logger.info("agent run started", {
      agentDescription: args.agentDescription,
      maxTurns: args.maxTurns,
      historyLength: args.history.length,
      promptRole: args.prompt.role,
      trace: args.trace,
    });
  }

  startGeneration(args: AgentGenerationStartArgs): AgentGenerationObserver {
    this.logger.info("agent generation started", generationStartContext(args, this.options));
    return new LoggerGenerationObserver(this.logger, this.options);
  }

  startTool(args: AgentToolStartArgs): AgentToolObserver {
    const context: LogContext = {
      turn: args.turn,
      toolName: args.toolName,
      internalCallId: args.internalCallId,
    };
    if (args.toolCallId !== undefined) context.toolCallId = args.toolCallId;
    const toolLogger = this.logger.child(context);
    toolLogger.info("agent tool started", {
      args: args.args,
      toolMetadata: args.toolMetadata,
    });
    return new LoggerToolObserver(toolLogger, this.options);
  }

  event(args: AgentRunEventArgs): void {
    const context: LogContext = {
      eventName: args.name,
      eventLevel: args.level ?? "DEFAULT",
    };
    if (args.timestamp !== undefined) context.eventTimestamp = args.timestamp;
    if (args.name === "completion.retry" && args.attributes !== undefined) {
      Object.assign(context, completionRetryContext(args.attributes));
    }
    if (args.level === "ERROR") {
      this.logger.error("agent event", context);
    } else if (args.level === "WARNING") {
      this.logger.warn("agent event", context);
    } else {
      this.logger.info("agent event", context);
    }
  }

  end(args: AgentRunEndArgs): void {
    const context: LogContext = {
      runId: args.runId,
      status: args.status,
      text: args.text,
      usage: args.usage,
      messageCount: args.messages.length,
    };
    if (args.resumedFrom !== undefined) context.resumedFrom = args.resumedFrom;
    if (args.status === "blocked") context.blockedStage = args.stage;
    if (this.options.includeOutput === true && args.status === "completed") {
      context.output = args.output;
    }
    this.logger.info("agent run ended", context);
  }

  error(args: AgentRunErrorArgs): void {
    this.logger.error("agent run failed", {
      error: serializeError(args.error),
      usage: args.usage,
      messageCount: args.messages.length,
    });
  }
}

const COMPLETION_RETRY_SCALAR_ATTRIBUTES = [
  "turn",
  "attempt",
  "nextAttempt",
  "maxAttempts",
  "delayMs",
  "streaming",
  "errorName",
  "statusCode",
  "errorCode",
  "failurePhase",
  "outputLength",
  "normalizedLength",
  "finishReason",
  "providerFinishReason",
  "previousResponse",
  "includedOutputLength",
] as const;

function completionRetryContext(attributes: Readonly<Record<string, unknown>>): LogContext {
  const context: LogContext = {};
  for (const name of COMPLETION_RETRY_SCALAR_ATTRIBUTES) {
    const value = attributes[name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      context[name] = value;
    }
  }
  for (const name of ["attemptUsage", "cumulativeUsage"] as const) {
    const value = attributes[name];
    if (isUsageMetadata(value)) context[name] = { ...value };
  }
  return context;
}

class LoggerGenerationObserver implements AgentGenerationObserver {
  constructor(
    private readonly logger: Logger,
    private readonly options: LoggerObserverOptions,
  ) {}

  end(args: AgentGenerationEndArgs): void {
    this.logger.info("agent generation ended", generationEndContext(args, this.options));
  }

  error(args: AgentGenerationErrorArgs): void {
    this.logger.error("agent generation failed", {
      turn: args.turn,
      error: serializeError(args.error),
    });
  }
}

class LoggerToolObserver implements AgentToolObserver {
  constructor(
    private readonly logger: Logger,
    private readonly options: LoggerObserverOptions,
  ) {}

  streamEvent(args: AgentToolStreamEventArgs): void {
    this.logger.debug("agent tool stream event", {
      event: args.event,
    });
  }

  end(args: AgentToolEndArgs): void {
    const context: LogContext = {
      skipped: args.skipped,
    };
    if (this.options.includeToolResult === true) {
      context.result = args.result;
      if (args.structuredResult !== undefined) {
        context.structuredResult = args.structuredResult;
      }
    }
    this.logger.info("agent tool ended", context);
  }

  suspend(args: AgentToolSuspendedArgs): void {
    this.logger.info("agent tool suspended", {
      interactionId: args.interaction.id,
      interactionType: args.interaction.type,
    });
  }

  error(args: AgentToolErrorArgs): void {
    this.logger.error("agent tool failed", {
      error: serializeError(args.error),
    });
  }
}

function generationStartContext(
  args: AgentGenerationStartArgs,
  options: LoggerObserverOptions,
): LogContext {
  const context: LogContext = {
    turn: args.turn,
    provider: args.modelInfo?.provider,
    model: args.modelInfo?.modelId,
    providerRequest: args.providerRequest,
  };
  if (options.includeRequest === true) context.request = args.request;
  return context;
}

function generationEndContext(
  args: AgentGenerationEndArgs,
  options: LoggerObserverOptions,
): LogContext {
  const context: LogContext = {
    turn: args.turn,
    firstDeltaMs: args.firstDeltaMs,
    usage: args.response.usage,
  };
  if (options.includeResponse === true) context.response = args.response;
  return context;
}

const MAX_SERIALIZED_ERROR_CAUSE_DEPTH = 16;

function serializeError(error: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (error instanceof Error) {
    if (seen.has(error)) return "[Circular error cause]";
    if (depth >= MAX_SERIALIZED_ERROR_CAUSE_DEPTH) return "[Error cause depth limit]";
    seen.add(error);
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (isStructuredOutputError(error)) {
      addStructuredOutputMetadata(serialized, error);
    }
    if (error.cause !== undefined) {
      if (isStructuredOutputError(error)) {
        serialized.cause = structuredOutputCauseMetadata(error.cause);
      } else {
        serialized.cause = serializeError(error.cause, seen, depth + 1);
      }
    }
    return serialized;
  }

  return error;
}

function addStructuredOutputMetadata(serialized: Record<string, unknown>, error: Error): void {
  const details = error as unknown as Record<string, unknown>;
  if (details.phase === "truncated" || details.phase === "parse" || details.phase === "schema") {
    serialized.phase = details.phase;
  }
  for (const name of ["attempt", "maxAttempts", "outputLength", "normalizedLength"] as const) {
    const value = details[name];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      serialized[name] = value;
    }
  }
  if (
    details.outputFormat === "raw" ||
    details.outputFormat === "json-fence" ||
    details.outputFormat === "unlabeled-fence"
  ) {
    serialized.outputFormat = details.outputFormat;
  }
  if (
    details.finishReason === "stop" ||
    details.finishReason === "length" ||
    details.finishReason === "content-filter" ||
    details.finishReason === "tool-calls" ||
    details.finishReason === "other"
  ) {
    serialized.finishReason = details.finishReason;
  }
  if (typeof details.providerFinishReason === "string") {
    serialized.providerFinishReason = details.providerFinishReason;
  }
  for (const name of ["attemptUsage", "usage"] as const) {
    if (isUsageMetadata(details[name])) serialized[name] = { ...details[name] };
  }
}

function isStructuredOutputError(error: Error): boolean {
  return (
    error.name === "AgentStructuredOutputError" || error.name === "CompletionStructuredOutputError"
  );
}

function isUsageMetadata(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number" &&
    typeof usage.totalTokens === "number"
  );
}

function structuredOutputCauseMetadata(cause: unknown): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    message: "Structured-output cause details redacted.",
  };
  if (cause instanceof Error) {
    metadata.name = cause.name;
  } else {
    metadata.type = cause === null ? "null" : typeof cause;
  }
  return metadata;
}
