import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentObserver,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
} from "@anvia/core/observability";
import type { LogContext, Logger } from "./types";

export type LoggerObserverOptions = {
  includeOutput?: boolean | undefined;
  includeRequest?: boolean | undefined;
  includeResponse?: boolean | undefined;
  includeToolResult?: boolean | undefined;
};

export function createLoggerObserver(
  logger: Logger,
  options: LoggerObserverOptions = {},
): AgentObserver {
  return {
    startRun(args) {
      return new LoggerRunObserver(logger, options, args);
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

  end(args: AgentRunEndArgs): void {
    const context: LogContext = {
      usage: args.usage,
      messageCount: args.messages.length,
    };
    if (this.options.includeOutput === true) context.output = args.output;
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
    model: args.modelInfo?.defaultModel,
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

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return error;
}
