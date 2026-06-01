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
    this.logger = logger.child({
      component: "anvia.agent",
      ...(args.agentName === undefined ? {} : { agentName: args.agentName }),
      ...(args.trace?.name === undefined ? {} : { traceName: args.trace.name }),
      ...(args.trace?.userId === undefined ? {} : { userId: args.trace.userId }),
      ...(args.trace?.sessionId === undefined ? {} : { sessionId: args.trace.sessionId }),
      ...(args.trace?.traceId === undefined ? {} : { traceId: args.trace.traceId }),
    });
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
    const toolLogger = this.logger.child({
      turn: args.turn,
      toolName: args.toolName,
      internalCallId: args.internalCallId,
      ...(args.toolCallId === undefined ? {} : { toolCallId: args.toolCallId }),
    });
    toolLogger.info("agent tool started", {
      args: args.args,
      toolMetadata: args.toolMetadata,
    });
    return new LoggerToolObserver(toolLogger, this.options);
  }

  end(args: AgentRunEndArgs): void {
    this.logger.info("agent run ended", {
      ...(this.options.includeOutput === true ? { output: args.output } : {}),
      usage: args.usage,
      messageCount: args.messages.length,
    });
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
    this.logger.info("agent tool ended", {
      skipped: args.skipped,
      ...(this.options.includeToolResult === true ? { result: args.result } : {}),
      ...(this.options.includeToolResult === true && args.structuredResult !== undefined
        ? { structuredResult: args.structuredResult }
        : {}),
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
  return {
    turn: args.turn,
    provider: args.modelInfo?.provider,
    model: args.modelInfo?.defaultModel,
    providerRequest: args.providerRequest,
    ...(options.includeRequest === true ? { request: args.request } : {}),
  };
}

function generationEndContext(
  args: AgentGenerationEndArgs,
  options: LoggerObserverOptions,
): LogContext {
  return {
    turn: args.turn,
    firstDeltaMs: args.firstDeltaMs,
    usage: args.response.usage,
    ...(options.includeResponse === true ? { response: args.response } : {}),
  };
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
