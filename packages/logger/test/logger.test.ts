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
    const observer = createLoggerObserver(logger, {
      includeToolResult: true,
    });

    const run = (await observer.startRun({
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
        defaultModel: "test-model",
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
        type: "tool_call",
        id: "tool_1",
        function: {
          name: "lookup",
          arguments: "{}",
        },
      },
      toolName: "lookup",
      args: "{}",
      internalCallId: "internal_1",
    })) as AgentToolObserver;

    tool.end({
      turn: 1,
      toolCall: {
        type: "tool_call",
        id: "tool_1",
        function: {
          name: "lookup",
          arguments: "{}",
        },
      },
      toolName: "lookup",
      args: "{}",
      internalCallId: "internal_1",
      result: "found",
      skipped: false,
    });

    run.end({
      output: "ok",
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
});

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
