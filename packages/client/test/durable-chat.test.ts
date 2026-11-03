import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { Message, ToolResultOutput } from "@anvia/core/completion";
import type {
  DurableEvent,
  DurableRunPage,
  DurableSnapshot,
  DurableSubmission,
} from "@anvia/durable/protocol";
import type { DurableSubmitOptions } from "@anvia/durable";
import { describe, expect, it } from "vitest";
import { DurableHttpError } from "../src/durable";
import {
  DurableBusyError,
  createDurableChatTransport,
  type DurableChatClient,
} from "../src/durable-chat";
import {
  createDurableChatMapState,
  durableChatMessageId,
  mapDurableChatEvent,
} from "../src/durable-chat-map";
import type { ClientStreamEvent, ClientStreamFrame, ClientStreamRequest } from "../src/types";

const runId = "run-1";
const at = "2026-01-01T00:00:00.000Z";

function event(
  sequence: number,
  type: DurableEvent["type"],
  data: DurableEvent["data"] = {},
): DurableEvent {
  return { sequence, runId, createdAt: at, type, data };
}

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

const usage = {
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const toolCall = {
  type: "tool-call",
  toolCallId: "call-1",
  toolName: "echo",
  input: { value: "hi" },
};

function mapAll(events: readonly DurableEvent[]): ClientStreamEvent[] {
  let state = createDurableChatMapState();
  const mapped: ClientStreamEvent[] = [];
  for (const value of events) {
    const next = mapDurableChatEvent(value, state);
    state = next.state;
    mapped.push(...next.events);
  }
  return mapped;
}

function types(events: readonly ClientStreamEvent[]): string[] {
  return events.map((value) => value.type);
}

describe("durable chat event mapping", () => {
  it("opens the run and an assistant message on submit", () => {
    const mapped = mapAll([event(1, "submitted", { prompt: "hi" })]);
    expect(types(mapped)).toEqual(["run_start"]);
    expect(mapped[0]).toMatchObject({ type: "run_start", source: "agent", runId });
  });

  it("opens the run from the first status when no submitted event is in the journal", () => {
    const mapped = mapAll([event(1, "status", { status: "running" })]);
    expect(types(mapped)).toEqual(["run_start"]);
  });

  it("starts a turn, generation and message on model_started", () => {
    const mapped = mapAll([
      event(1, "submitted", {}),
      event(2, "model_started", {
        operationId: "0:model:1",
        input: { provider: "openai", modelId: "gpt-5", request: {} },
      }),
    ]);
    expect(types(mapped)).toEqual(["run_start", "turn_start", "generation_start", "message_start"]);
    expect(mapped[2]).toMatchObject({
      type: "generation_start",
      model: { provider: "openai", modelId: "gpt-5" },
    });
  });

  it("opens exactly one assistant message for a streamed model operation", () => {
    const mapped = mapAll([
      event(1, "submitted", {}),
      event(2, "model_started", { operationId: "0:model:1", input: {} }),
      event(3, "model_attempt_started", {
        operationId: "0:model:1",
        attemptId: "a1",
        attempt: 1,
      }),
      event(4, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "text_delta", delta: "Hi", turn: 1 },
      }),
      event(5, "model_completed", {
        operationId: "0:model:1",
        attemptId: "a1",
        result: { choice: [{ type: "text", text: "Hi" }] },
      }),
    ]);
    const starts = mapped.filter((value) => value.type === "message_start");
    expect(starts).toHaveLength(1);
    const delta = mapped.find((value) => value.type === "text_delta");
    expect(delta?.messageId).toBe(
      starts[0]?.type === "message_start" ? starts[0].messageId : undefined,
    );
    expect(
      mapped.some(
        (value) => "messageId" in value && value.messageId === `${runId}:assistant:pending`,
      ),
    ).toBe(false);
  });

  it("maps text deltas and emits the start only once per part", () => {
    const operation = { operationId: "0:model:1", attemptId: "a1" };
    const mapped = mapAll([
      event(1, "model_started", { operationId: "0:model:1", input: {} }),
      event(2, "model_delta", {
        ...operation,
        event: { type: "text_delta", delta: "Hel", turn: 1 },
      }),
      event(3, "model_delta", {
        ...operation,
        event: { type: "text_delta", delta: "lo", turn: 1 },
      }),
    ]);
    expect(types(mapped)).toEqual([
      "run_start",
      "turn_start",
      "generation_start",
      "message_start",
      "text_start",
      "text_delta",
      "text_delta",
    ]);
    expect(mapped.at(-1)).toMatchObject({ type: "text_delta", delta: "lo" });
  });

  it("maps reasoning deltas and their start", () => {
    const mapped = mapAll([
      event(1, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: {
          type: "reasoning_delta",
          delta: "because",
          id: "reason-1",
          contentType: "summary",
          turn: 1,
        },
      }),
    ]);
    expect(types(mapped)).toEqual(["reasoning_start", "reasoning_delta"]);
    expect(mapped[0]).toMatchObject({ reasoningId: "reason-1" });
    expect(mapped[1]).toMatchObject({ contentType: "summary" });
  });

  it("maps tool-call deltas, completed calls and sources", () => {
    const delta = mapAll([
      event(1, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: {
          type: "tool_call_delta",
          id: "call-1",
          callId: "call-1",
          name: "echo",
          argumentsDelta: '{"value":',
          argumentsMode: "append",
          turn: 1,
        },
      }),
    ]);
    expect(types(delta)).toEqual(["tool_call_start", "tool_call_delta"]);

    const call = mapAll([
      event(1, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "tool_call", toolCall, turn: 1 },
      }),
    ]);
    expect(types(call)).toEqual(["tool_call_end"]);

    const source = mapAll([
      event(1, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "source", source: { type: "url", url: "https://example.test" }, turn: 1 },
      }),
    ]);
    expect(types(source)).toEqual(["source"]);
  });

  it("resets the open message when a model operation retries", () => {
    const mapped = mapAll([
      event(1, "model_started", { operationId: "0:model:1", input: {} }),
      event(2, "model_attempt_started", { operationId: "0:model:1", attemptId: "a2", attempt: 2 }),
    ]);
    expect(types(mapped)).toEqual([
      "run_start",
      "turn_start",
      "generation_start",
      "message_start",
      "message_reset",
    ]);
  });

  it("reports a retryable error for a failed model attempt", () => {
    const mapped = mapAll([
      event(1, "model_attempt_failed", { operationId: "0:model:1", error: "rate limited" }),
    ]);
    expect(types(mapped)).toEqual(["error"]);
    expect(mapped[0]).toMatchObject({
      type: "error",
      error: { name: "DurableModelAttemptError", retryable: true },
    });
  });

  it("closes the text part and the message with usage on model_completed", () => {
    const mapped = mapAll([
      event(1, "model_completed", {
        operationId: "0:model:1",
        attemptId: "a1",
        result: {
          choice: [{ type: "text", text: "Hello" }],
          messageId: "model-message",
          usage,
        },
      }),
    ]);
    expect(types(mapped)).toEqual(["text_start", "text_end", "message_end"]);
    expect(mapped[1]).toMatchObject({ type: "text_end", text: "Hello" });
    expect(mapped[2]).toMatchObject({
      type: "message_end",
      modelMessageId: "model-message",
      usage,
    });
  });

  it("maps tool_started and tool_completed into a matching call and result", () => {
    const mapped = mapAll([
      event(1, "tool_started", { operationId: "0:tool:1", input: { toolCall } }),
      event(2, "tool_completed", {
        operationId: "0:tool:1",
        result: { output: { type: "json", value: { ok: true } }, failed: false },
      }),
    ]);
    expect(types(mapped)).toEqual(["tool_call_end", "tool_result"]);
    const end = mapped[0];
    const result = mapped[1];
    if (end?.type !== "tool_call_end" || result?.type !== "tool_result") {
      throw new Error("Expected a tool call and its result.");
    }
    expect(result).toMatchObject({
      toolCallId: "call-1",
      toolName: "echo",
      result: { status: "success", output: { ok: true } },
    });
    expect(result.partId).toBe(end.partId);
    expect(result.messageId).toBe(end.messageId);
  });

  it("maps a failed tool result with the recorded call identity", () => {
    const mapped = mapAll([
      event(1, "tool_started", { operationId: "0:tool:1", input: { toolCall } }),
      event(2, "tool_completed", {
        operationId: "0:tool:1",
        result: { output: { type: "error-text", value: "boom" }, failed: true, error: "boom" },
      }),
    ]);
    const result = mapped[1];
    if (result?.type !== "tool_result") throw new Error("Expected a tool result.");
    expect(result).toMatchObject({
      toolCallId: "call-1",
      toolName: "echo",
      result: { status: "error", error: { message: "boom" } },
    });
  });

  it("maps completed compaction", () => {
    const mapped = mapAll([
      event(1, "compaction_completed", {
        originalMessageCount: 10,
        compactedMessageCount: 8,
        retainedMessageCount: 2,
        originalTokenCount: 100,
        compactedTokenCount: 20,
        retainedTokenCount: 10,
        resultTokenCount: 30,
        attempts: 1,
        usage,
      }),
    ]);
    expect(types(mapped)).toEqual(["memory_compaction"]);
  });

  it("maps a waiting status to an interaction followed by a suspended run_end", () => {
    const mapped = mapAll([
      event(1, "status", {
        status: "waiting",
        outcome: {
          type: "interaction",
          interaction: {
            id: "interaction-1",
            type: "tool-approval",
            toolName: "echo",
            toolCallId: "call-1",
            internalCallId: "call-1",
            input: {},
          },
        },
      }),
    ]);
    expect(types(mapped)).toEqual(["interaction", "run_end"]);
    expect(mapped[1]).toMatchObject({ type: "run_end", status: "suspended" });
  });

  it("maps terminal statuses to run_end and errors", () => {
    const completed = mapAll([
      event(1, "status", {
        status: "completed",
        outcome: { type: "response", text: "done", usage },
      }),
    ]);
    expect(completed[0]).toMatchObject({
      type: "run_end",
      status: "completed",
      text: "done",
      usage,
    });

    const failed = mapAll([event(1, "status", { status: "failed", error: "boom" })]);
    expect(types(failed)).toEqual(["error", "run_end"]);
    expect(failed[0]).toMatchObject({ type: "error", error: { code: "failed" } });
    expect(failed[1]).toMatchObject({ type: "run_end", status: "error" });

    const blocked = mapAll([
      event(1, "status", {
        status: "needs_attention",
        error: "reconcile",
        blockedOperation: "0:tool:1",
      }),
    ]);
    expect(types(blocked)).toEqual(["error", "run_end"]);
    expect(blocked[0]).toMatchObject({
      type: "error",
      error: { code: "needs_attention", retryable: true },
    });

    const cancelled = mapAll([event(1, "status", { status: "cancelled" })]);
    expect(cancelled[0]).toMatchObject({ type: "run_end", status: "cancelled" });
  });

  it("ignores a sequence at or behind the projection cursor", () => {
    const state = { ...createDurableChatMapState(5) };
    const mapped = mapDurableChatEvent(event(5, "submitted", {}), state);
    expect(mapped.events).toEqual([]);
    expect(mapped.state.sequence).toBe(5);
  });

  it("keeps message identities stable across a replay", () => {
    const id = durableChatMessageId(runId, "0:model:1");
    const first = mapAll([
      event(1, "model_started", { operationId: "0:model:1", input: {} }),
      event(2, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "text_delta", delta: "hi", turn: 1 },
      }),
    ]);
    const replayed = mapAll([
      event(1, "model_started", { operationId: "0:model:1", input: {} }),
      event(2, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "text_delta", delta: "hi", turn: 1 },
      }),
    ]);
    expect(first.at(-1)).toMatchObject({ messageId: id });
    expect(replayed.at(-1)).toMatchObject({ messageId: id });
  });
});

class FakeClient {
  events: DurableEvent[] = [];
  submitCalls: Array<{ submission: DurableSubmission; options: DurableSubmitOptions }> = [];
  respondCalls: Array<{
    runId: string;
    interactionId: string;
    response: AgentInteractionResponse;
  }> = [];
  streamCalls: Array<{ runId: string; after: number; aborted: boolean }> = [];
  cancelCalls: string[] = [];
  retryCalls: string[] = [];
  resolveCalls: Array<{ runId: string; operationId: string; output: ToolResultOutput }> = [];
  failSubmit?: Error;
  busyRunId?: string;

  async submit(
    submission: DurableSubmission,
    options: DurableSubmitOptions = {},
  ): Promise<DurableSnapshot> {
    this.submitCalls.push({ submission, options });
    if (this.failSubmit !== undefined) throw this.failSubmit;
    return { run: { id: runId } } as unknown as DurableSnapshot;
  }

  async *stream(
    id: string,
    options: { after?: number; abortSignal?: AbortSignal } = {},
  ): AsyncIterable<DurableEvent> {
    const after = options.after ?? 0;
    this.streamCalls.push({ runId: id, after, aborted: options.abortSignal?.aborted ?? false });
    for (const value of this.events) {
      if (value.sequence <= after) continue;
      options.abortSignal?.throwIfAborted();
      yield value;
    }
  }

  async respond(
    id: string,
    interactionId: string,
    response: AgentInteractionResponse,
  ): Promise<void> {
    this.respondCalls.push({ runId: id, interactionId, response });
  }

  async cancel(id: string): Promise<void> {
    this.cancelCalls.push(id);
  }

  async retry(id: string): Promise<void> {
    this.retryCalls.push(id);
  }

  async resolveTool(id: string, operationId: string, output: ToolResultOutput): Promise<void> {
    this.resolveCalls.push({ runId: id, operationId, output });
  }

  async listRuns(): Promise<DurableRunPage> {
    return {
      runs:
        this.busyRunId === undefined
          ? []
          : ([{ id: this.busyRunId, status: "running" }] as unknown as DurableRunPage["runs"]),
    };
  }
}

function clientOf(fake: FakeClient): DurableChatClient {
  return fake as unknown as DurableChatClient;
}

async function collect(frames: AsyncIterable<ClientStreamFrame>): Promise<ClientStreamFrame[]> {
  const values: ClientStreamFrame[] = [];
  for await (const frame of frames) values.push(frame);
  return values;
}

function request(type: ClientStreamRequest["type"], value: Partial<ClientStreamRequest> = {}) {
  if (type === "messages") {
    return { type, messages: [user("hello")], ...value } as ClientStreamRequest;
  }
  return {
    type,
    interactionId: "interaction-1",
    response: { type: "tool-approval", approved: true },
    ...value,
  } as ClientStreamRequest;
}

describe("durable chat transport", () => {
  it("submits the last user message, queues it, and streams the run", async () => {
    const fake = new FakeClient();
    fake.events = [
      event(1, "submitted", {}),
      event(2, "model_delta", {
        operationId: "0:model:1",
        attemptId: "a1",
        event: { type: "text_delta", delta: "hi", turn: 1 },
      }),
    ];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    const frames = await collect(transport.send({ request: request("messages") }));

    expect(fake.submitCalls).toHaveLength(1);
    expect(fake.submitCalls[0]?.submission).toMatchObject({
      agentId: "agent-1",
      sessionId: "session-1",
      prompt: { role: "user" },
    });
    expect(fake.submitCalls[0]?.options.enqueue).toBe(true);
    expect(frames[0]).toMatchObject({ type: "stream_start", streamId: runId });
    expect(transport.controller.activeRunId).toBe(runId);
    expect(frames.at(-1)).toMatchObject({ type: "stream_end", status: "completed" });
  });

  it("routes an interaction response to the active run and resumes after it", async () => {
    const fake = new FakeClient();
    fake.events = [event(1, "submitted", {})];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await collect(transport.send({ request: request("messages") }));
    fake.events.push(event(2, "status", { status: "completed" }));
    await collect(transport.send({ request: request("interaction_response") }));

    expect(fake.respondCalls[0]).toMatchObject({
      runId,
      interactionId: "interaction-1",
      response: { type: "tool-approval", approved: true },
    });
    expect(fake.streamCalls.at(-1)).toMatchObject({ runId, after: 1 });
  });

  it("rejects an interaction response without an active run", async () => {
    const fake = new FakeClient();
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await expect(
      collect(transport.send({ request: request("interaction_response") })),
    ).rejects.toThrow("No active durable run");
  });

  it("resumes from a stored stream id and cursor without submitting", async () => {
    const fake = new FakeClient();
    fake.events = [event(4, "status", { status: "completed" })];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await collect(
      transport.send({
        request: request("messages"),
        resume: { streamId: runId, after: 3 },
      }),
    );
    expect(fake.submitCalls).toHaveLength(0);
    expect(fake.streamCalls[0]).toMatchObject({ runId, after: 3 });
  });

  it("does not reopen the run when a background run is reattached", async () => {
    const fake = new FakeClient();
    fake.events = [event(1, "submitted", {})];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await collect(transport.send({ request: request("messages") }));
    fake.events.push(event(2, "status", { status: "running" }));
    const frames = await collect(
      transport.send({
        request: request("messages"),
        resume: { streamId: runId, after: 1 },
      }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "stream_event" ? [frame.event.type] : [],
    );
    expect(events).not.toContain("run_start");
  });

  it("detaches on abort without cancelling the run", async () => {
    const fake = new FakeClient();
    fake.events = [event(1, "submitted", {}), event(2, "status", { status: "running" })];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    const controller = new AbortController();
    const iterator = transport
      .send({ request: request("messages"), abortSignal: controller.signal })
      [Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
    expect(fake.cancelCalls).toEqual([]);
  });

  it("reports a busy session with the run to reattach to", async () => {
    const fake = new FakeClient();
    fake.failSubmit = new DurableHttpError(
      409,
      undefined,
      undefined,
      "Session already has unfinished work.",
    );
    fake.busyRunId = "busy-run";
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await expect(collect(transport.send({ request: request("messages") }))).rejects.toMatchObject({
      name: "DurableBusyError",
      runId: "busy-run",
    } satisfies Partial<DurableBusyError>);
  });

  it("exposes explicit run controls", async () => {
    const fake = new FakeClient();
    fake.events = [event(1, "submitted", {})];
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await collect(transport.send({ request: request("messages") }));
    await transport.controller.cancel();
    await transport.controller.retry();
    await transport.controller.resolveTool("0:tool:1", { type: "text", value: "ok" });
    transport.controller.reattach("other-run", 9);
    expect(transport.controller.activeRunId).toBe("other-run");
    expect(fake.cancelCalls).toEqual([runId]);
    expect(fake.retryCalls).toEqual([runId]);
    expect(fake.resolveCalls[0]).toMatchObject({ runId, operationId: "0:tool:1" });
  });

  it("uses a caller-provided request id", async () => {
    const fake = new FakeClient();
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
      requestId: () => "request-1",
    });
    await collect(transport.send({ request: request("messages") }));
    expect(fake.submitCalls[0]?.submission.requestId).toBe("request-1");
  });

  it("ignores an empty user history", async () => {
    const fake = new FakeClient();
    const transport = createDurableChatTransport({
      client: clientOf(fake),
      agentId: "agent-1",
      sessionId: "session-1",
    });
    await expect(
      collect(
        transport.send({
          request: { type: "messages", messages: [{ role: "assistant", content: [] }] },
        }),
      ),
    ).rejects.toThrow("requires a user message");
    expect(fake.submitCalls).toHaveLength(0);
  });
});
