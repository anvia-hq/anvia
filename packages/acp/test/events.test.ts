import { Agent } from "@anvia/core/agent";
import type { AgentStreamEvent } from "@anvia/core/agent";
import { Usage, type ToolCallPart, type ToolResultOutput } from "@anvia/core/completion";
import { describe, expect, it, vi } from "vitest";
import { TurnEvents, type SessionUpdate } from "../src/events.js";
import { presentTool } from "../src/presentation.js";
import { deferred, makeAgent } from "./helpers.js";

const call = (id = "local", callId = "reused-provider-id"): ToolCallPart => ({
  type: "tool-call",
  toolCallId: id,
  callId,
  toolName: "read",
  input: { secret: "private-input" },
  signature: "private-signature",
});
const result = (
  turn: number,
  id: string,
  internalCallId: string,
  output: ToolResultOutput,
): AgentStreamEvent => ({
  type: "tool_result",
  turn,
  toolName: "read",
  toolCallId: id,
  callId: "reused-provider-id",
  internalCallId,
  args: "private-input",
  output,
  result: "private-result",
});

function fixture(reasoning = false) {
  let sequence = 0;
  const updates: SessionUpdate[] = [];
  const mapper = new TurnEvents(
    () => `session:${++sequence}`,
    "/workspace",
    makeAgent(),
    reasoning,
    async (update) => {
      updates.push(update);
    },
  );
  return { mapper, updates };
}

describe("stream event projection", () => {
  it("correlates partial calls and out-of-order results despite repeated provider IDs", async () => {
    const { mapper, updates } = fixture();
    await mapper.accept({ type: "tool_call_delta", turn: 0, id: "a", argumentsDelta: "private" });
    await mapper.accept({ type: "tool_call_delta", turn: 0, id: "a", name: "read" });
    await mapper.accept({ type: "tool_call", turn: 0, toolCall: call("a") });
    await mapper.accept({ type: "tool_call", turn: 0, toolCall: call("b") });
    await mapper.accept(result(0, "b", "exec-b", { type: "text", value: "secret" }));
    await mapper.accept(result(0, "a", "exec-a", { type: "json", value: { secret: true } }));
    await mapper.accept(result(0, "a", "exec-a", { type: "text", value: "duplicate" }));
    // Both the local ID and the provider ID can repeat in a later generation.
    await mapper.accept({ type: "tool_call", turn: 1, toolCall: call("a") });
    await mapper.accept(result(1, "a", "exec-next", { type: "content", value: [] }));
    expect(updates.filter((u) => u.type === "tool").map((u) => u.id)).toEqual([
      "session:1",
      "session:2",
      "session:3",
    ]);
    expect(
      updates
        .filter((u) => u.type === "tool-update")
        .filter((u) => u.status === "completed")
        .map((u) => u.id),
    ).toEqual(["session:2", "session:1", "session:3"]);
    expect(JSON.stringify(updates)).not.toMatch(/private|secret|reused-provider-id/);
  });

  it.each<ToolResultOutput>([
    { type: "execution-denied", reason: "private-denial" },
    { type: "error-text", value: "private-error" },
    { type: "error-json", value: { token: "private-token" } },
  ])("marks $type failed without exposing failure details", async (output) => {
    const { mapper, updates } = fixture();
    await mapper.accept(result(0, "a", "exec-a", output));
    expect(updates).toMatchObject([
      { type: "tool", id: "session:1" },
      { type: "tool-update", id: "session:1", status: "failed" },
    ]);
    expect(JSON.stringify(updates)).not.toContain("private");
  });

  it("suppresses reasoning by default and never forwards encrypted data or signatures", async () => {
    for (const enabled of [false, true]) {
      const { mapper, updates } = fixture(enabled);
      for (const contentType of [undefined, "text", "summary", "encrypted", "redacted"] as const) {
        const event: AgentStreamEvent = {
          type: "reasoning_delta",
          turn: 0,
          delta: contentType ?? "plain",
          signature: "secret-signature",
        };
        if (contentType !== undefined) event.contentType = contentType;
        await mapper.accept(event);
      }
      expect(updates).toEqual(
        enabled
          ? [
              { type: "thought", text: "plain" },
              { type: "thought", text: "text" },
              { type: "thought", text: "summary" },
            ]
          : [],
      );
    }
  });

  it("uses one real stream consumer, awaits each update and never replays final text", async () => {
    const gate = deferred();
    const updates: SessionUpdate[] = [];
    const generated = vi.fn();
    const agent = new Agent({
      id: "single-consumer",
      model: {
        ...makeAgent().model,
        capabilities: { ...makeAgent().model.capabilities, streaming: true },
        async *streamCompletion() {
          generated();
          yield { type: "text_delta" as const, delta: "first" };
          yield { type: "text_delta" as const, delta: "second" };
          yield {
            type: "final" as const,
            response: {
              choice: [{ type: "text" as const, text: "firstsecond" }],
              usage: Usage.empty(),
              rawResponse: {},
            },
          };
        },
      },
    });
    const stream = agent.stream({ prompt: "hello" });
    const events = vi.spyOn(stream, "events", "get");
    const final = vi.spyOn(stream, "result", "get");
    const mapper = new TurnEvents(
      () => "unused",
      "/workspace",
      { agent },
      false,
      async (update) => {
        updates.push(update);
        await gate.promise;
      },
    );
    const pending = mapper.consume(stream);
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(final).not.toHaveBeenCalled();
    gate.resolve();
    await expect(pending).resolves.toMatchObject({ type: "response", text: "firstsecond" });
    expect(updates).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
    expect(events).toHaveBeenCalledOnce();
    expect(final).toHaveBeenCalledOnce();
    expect(generated).toHaveBeenCalledOnce();
  });

  it("normalizes host metadata and leaves unknown kinds and paths conservative", () => {
    expect(
      presentTool("read", "/workspace", {
        title: "Read\nfile",
        kind: "read",
        locations: [
          { path: "src/file.ts", line: 3 },
          { path: "/shared/file.ts", line: -1 },
          { path: "bad\0path" },
        ],
      }),
    ).toEqual({
      title: "Read file",
      kind: "read",
      locations: [{ path: "/workspace/src/file.ts", line: 3 }, { path: "/shared/file.ts" }],
    });
    expect(presentTool(undefined, "/workspace")).toEqual({
      title: "Tool call",
      kind: "other",
      locations: [],
    });
  });
});
