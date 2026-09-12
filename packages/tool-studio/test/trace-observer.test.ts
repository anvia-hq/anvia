import type { AgentToolStartArgs } from "@anvia/core/observability";
import { describe, expect, it } from "vitest";
import {
  AgentRunCancelledError,
  AssistantContent,
  Message,
  Usage,
} from "../../core/test/helpers/imports";
import { StudioTraceObserver } from "../src/traces/trace-observer";
import type { StudioTrace, StudioTraceStore } from "../src/types";

describe("StudioTraceObserver", () => {
  it("preserves cancellation status for nested Agent observations", async () => {
    let savedTrace: StudioTrace | undefined;
    const store: StudioTraceStore = {
      listSessionTraces: () => [],
      getTrace: () => undefined,
      saveTrace(trace) {
        savedTrace = trace;
        return trace;
      },
    };
    const observer = new StudioTraceObserver({ store });
    const run = observer.startRun({
      runId: "run_parent",
      prompt: Message.user("delegate"),
      history: [],
      maxTurns: 1,
      trace: { sessionId: "session_1" },
    });
    const toolArgs: AgentToolStartArgs = {
      turn: 1,
      toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "wait" }),
      toolName: "ask_child",
      args: '{"prompt":"wait"}',
      internalCallId: "internal_child",
      toolCallId: "call_child",
    };
    const tool = await run.startTool?.(toolArgs);
    const cancellation = new AgentRunCancelledError([], "parent stopped");

    await tool?.streamEvent?.({
      ...toolArgs,
      event: {
        agentId: "child",
        agentName: "Child Agent",
        event: { type: "error", error: cancellation, usage: Usage.empty() },
      },
    });
    await tool?.end({ ...toolArgs, result: "", skipped: false });
    await run.error?.({
      status: "cancelled",
      error: cancellation,
      usage: Usage.empty(),
      messages: [Message.user("delegate")],
    });

    expect(savedTrace?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent", name: "Child_Agent.run", status: "cancelled" }),
        expect.objectContaining({
          kind: "tool",
          name: "Child_Agent.error",
          status: "cancelled",
        }),
      ]),
    );
  });

  it("omits stack traces from persisted error payloads", async () => {
    let savedTrace: StudioTrace | undefined;
    const store: StudioTraceStore = {
      listSessionTraces: () => [],
      getTrace: () => undefined,
      saveTrace(trace) {
        savedTrace = trace;
        return trace;
      },
    };
    const observer = new StudioTraceObserver({ store });
    const run = observer.startRun({
      runId: "run_error",
      prompt: Message.user("boom"),
      history: [],
      maxTurns: 1,
      trace: { sessionId: "session_1" },
    });
    const toolArgs: AgentToolStartArgs = {
      turn: 1,
      toolCall: AssistantContent.toolCall("call_tool", "explode", { prompt: "boom" }),
      toolName: "explode",
      args: '{"prompt":"boom"}',
      internalCallId: "internal_tool",
      toolCallId: "call_tool",
    };
    const tool = await run.startTool?.(toolArgs);

    await tool?.error?.({ ...toolArgs, error: new Error("tool boom") });
    await run.error?.({
      status: "failed",
      error: new Error("run boom"),
      usage: Usage.empty(),
      messages: [Message.user("boom")],
    });

    expect(savedTrace?.error).toEqual({ name: "Error", message: "run boom" });
    const toolErrorObservation = savedTrace?.observations.find(
      (observation) => observation.kind === "tool" && observation.name === "explode",
    );
    expect(toolErrorObservation?.error).toEqual({ name: "Error", message: "tool boom" });
    expect(JSON.stringify(savedTrace)).not.toContain('"stack"');
  });
});
