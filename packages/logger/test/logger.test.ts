import { AgentStructuredOutputError, Usage } from "@anvia/core";
import type { AgentRunObserver, AgentToolObserver } from "@anvia/core/observability";
import { describe, expect, it } from "vitest";
import { createConsoleLogger, createLoggerObserver, createPinoLogger, type Logger } from "../src";

describe("createConsoleLogger", () => {
  it("writes structured JSON logs and filters below the configured level", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({
      level: "info",
      name: "test-app",
      bindings: { requestId: "req_1" },
      timestamp: () => new Date("2026-06-01T00:00:00.000Z"),
      writer: (line) => lines.push(line),
    });

    logger.debug("hidden", { hidden: true });
    logger.info("visible", { value: 1 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      time: "2026-06-01T00:00:00.000Z",
      level: "info",
      msg: "visible",
      name: "test-app",
      requestId: "req_1",
      value: 1,
    });
  });

  it("creates child loggers with inherited bindings", () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({
      level: "trace",
      bindings: { service: "api" },
      timestamp: () => new Date("2026-06-01T00:00:00.000Z"),
      writer: (line) => lines.push(line),
    }).child({ agentName: "support" });

    logger.trace("child log");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      service: "api",
      agentName: "support",
      msg: "child log",
    });
  });
});

describe("createPinoLogger", () => {
  it("adapts Pino to the Anvia logger interface", () => {
    const lines: unknown[] = [];
    const logger = createPinoLogger({
      level: "info",
      name: "test-app",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line));
        },
      },
    });

    logger.info("hello", { value: 1 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 30,
      name: "test-app",
      msg: "hello",
      value: 1,
    });
  });
});

describe("createLoggerObserver", () => {
  it("logs agent run, generation, and tool lifecycle events", async () => {
    const logger = new RecordingLogger();
    const observer = createLoggerObserver({
      logger,
      includeToolResult: true,
    });

    const run = (await observer.startRun({
      runId: "run_1",
      agentName: "support",
      agentDescription: "Support assistant",
      instructions: "Answer support questions.",
      trace: {
        name: "support-run",
        userId: "user_1",
        sessionId: "session_1",
      },
      prompt: { role: "user", content: [{ type: "text", text: "summarize" }] },
      history: [],
      maxTurns: 2,
    })) as AgentRunObserver;

    const generation = await run.startGeneration?.({
      turn: 1,
      request: {
        chatHistory: [{ role: "user", content: [{ type: "text", text: "summarize" }] }],
        documents: [],
        tools: [],
      },
      providerRequest: { provider: "test" },
      modelInfo: {
        provider: "test",
        modelId: "test-model",
      },
    });

    generation?.end({
      turn: 1,
      response: {
        choice: [{ type: "text", text: "ok" }],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rawResponse: {},
      },
    });

    const tool = (await run.startTool?.({
      turn: 1,
      toolCall: {
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "lookup",
        input: {},
      },
      toolName: "lookup",
      args: "{}",
      internalCallId: "internal_1",
    })) as AgentToolObserver;

    tool.end({
      turn: 1,
      toolCall: {
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "lookup",
        input: {},
      },
      toolName: "lookup",
      args: "{}",
      internalCallId: "internal_1",
      result: "found",
      skipped: false,
    });

    run.end({
      status: "completed",
      runId: "run_1",
      output: "ok",
      text: "ok",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      messages: [],
    });

    expect(logger.records.map((record) => record.message)).toEqual([
      "agent run started",
      "agent generation started",
      "agent generation ended",
      "agent tool started",
      "agent tool ended",
      "agent run ended",
    ]);
    expect(logger.records[0]?.context).toMatchObject({
      component: "anvia.agent",
      runId: "run_1",
      agentName: "support",
      userId: "user_1",
      sessionId: "session_1",
      maxTurns: 2,
    });
    expect(logger.records[0]?.context).not.toHaveProperty("traceId");
    expect(logger.records[1]?.context).not.toHaveProperty("request");
    expect(logger.records[2]?.context).not.toHaveProperty("response");
    expect(logger.records[3]?.context).not.toHaveProperty("toolCallId");
    expect(logger.records[4]?.context).toMatchObject({
      toolName: "lookup",
      result: "found",
    });
    expect(logger.records[5]?.context).not.toHaveProperty("output");
  });

  it("logs completion retry events with diagnostics and without model output", async () => {
    const logger = new RecordingLogger();
    const observer = createLoggerObserver({ logger });
    const run = (await observer.startRun({
      runId: "run_retry",
      prompt: { role: "user", content: "hello" },
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.event?.({
      name: "completion.retry",
      level: "WARNING",
      attributes: {
        attempt: 1,
        maxAttempts: 2,
        failurePhase: "truncated",
        finishReason: "length",
        outputLength: 140_542,
        attemptUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        cumulativeUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        previousResponse: "omitted",
        includedOutputLength: 0,
      },
    });

    expect(logger.records.at(-1)).toMatchObject({
      level: "warn",
      message: "agent event",
      context: {
        eventName: "completion.retry",
        eventLevel: "WARNING",
        attempt: 1,
        maxAttempts: 2,
        failurePhase: "truncated",
        finishReason: "length",
        outputLength: 140_542,
        previousResponse: "omitted",
        includedOutputLength: 0,
      },
    });
    expect(JSON.stringify(logger.records.at(-1))).not.toContain("model output");
  });

  it("does not log arbitrary observer event attributes by default", async () => {
    const logger = new RecordingLogger();
    const observer = createLoggerObserver({ logger });
    const run = (await observer.startRun({
      runId: "run_event",
      prompt: { role: "user", content: "hello" },
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;

    await run.event?.({
      name: "guardrail.decision",
      level: "WARNING",
      attributes: {
        decision: "deny",
        reason: "customer-secret-guardrail-reason",
      },
    });

    expect(logger.records.at(-1)).toMatchObject({
      level: "warn",
      message: "agent event",
      context: {
        eventName: "guardrail.decision",
        eventLevel: "WARNING",
      },
    });
    expect(JSON.stringify(logger.records.at(-1))).not.toContain("customer-secret");
    expect(logger.records.at(-1)?.context).not.toHaveProperty("decision");
    expect(logger.records.at(-1)?.context).not.toHaveProperty("reason");
  });

  it("serializes nested Error causes before handing them to Pino", async () => {
    const lines: Array<Record<string, unknown>> = [];
    const logger = createPinoLogger({
      level: "error",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    });
    const observer = createLoggerObserver({ logger });
    const run = (await observer.startRun({
      runId: "run_error",
      prompt: { role: "user", content: "hello" },
      history: [],
      maxTurns: 1,
    })) as AgentRunObserver;
    const rootCause = new SyntaxError("Unexpected token");
    const nestedCause = new Error("Invalid JSON", { cause: rootCause });
    const error = new Error("Structured output failed", { cause: nestedCause });

    run.error?.({
      error,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      messages: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.error).toMatchObject({
      name: "Error",
      message: "Structured output failed",
      stack: expect.any(String),
      cause: {
        name: "Error",
        message: "Invalid JSON",
        stack: expect.any(String),
        cause: {
          name: "SyntaxError",
          message: "Unexpected token",
          stack: expect.any(String),
        },
      },
    });
  });

  it("redacts structured-output cause details while retaining safe diagnostics", async () => {
    const rejectedOutput = "customer-secret-structured-output";
    const error = new AgentStructuredOutputError({
      phase: "parse",
      attempt: 2,
      maxAttempts: 2,
      outputLength: rejectedOutput.length,
      normalizedLength: rejectedOutput.length,
      outputFormat: "raw",
      attemptUsage: Usage.empty(),
      usage: Usage.empty(),
      cause: new SyntaxError(`Unexpected token in ${rejectedOutput}`),
    });

    const record = await recordPinoRunError(error);

    expect(JSON.stringify(record)).not.toContain(rejectedOutput);
    expect(record.error).toMatchObject({
      name: "AgentStructuredOutputError",
      phase: "parse",
      attempt: 2,
      maxAttempts: 2,
      outputLength: rejectedOutput.length,
      normalizedLength: rejectedOutput.length,
      outputFormat: "raw",
      cause: {
        name: "SyntaxError",
        message: "Structured-output cause details redacted.",
      },
    });
  });

  it("bounds deeply nested error-cause serialization", async () => {
    let error: Error = new Error("root cause");
    for (let depth = 0; depth < 100; depth += 1) {
      error = new Error(`cause ${depth}`, { cause: error });
    }

    const record = await recordPinoRunError(error);

    expect(JSON.stringify(record)).toContain("[Error cause depth limit]");
  });
});

async function recordPinoRunError(error: Error): Promise<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = [];
  const observer = createLoggerObserver({
    logger: createPinoLogger({
      level: "error",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    }),
  });
  const run = (await observer.startRun({
    runId: "run_error",
    prompt: { role: "user", content: "hello" },
    history: [],
    maxTurns: 1,
  })) as AgentRunObserver;
  run.error?.({ error, usage: Usage.empty(), messages: [] });
  const record = lines[0];
  if (record === undefined) throw new Error("Expected Pino error record.");
  return record;
}

class RecordingLogger implements Logger {
  readonly records: { level: string; message: string; context: Record<string, unknown> }[];

  constructor(
    private readonly bindings: Record<string, unknown> = {},
    records?: { level: string; message: string; context: Record<string, unknown> }[],
  ) {
    this.records = records ?? [];
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.record("trace", message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.record("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.record("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.record("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.record("error", message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.record("fatal", message, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new RecordingLogger({ ...this.bindings, ...bindings }, this.records);
  }

  private record(level: string, message: string, context?: Record<string, unknown>): void {
    const mergedContext = { ...this.bindings };
    Object.assign(mergedContext, context);
    this.records.push({
      level,
      message,
      context: mergedContext,
    });
  }
}
