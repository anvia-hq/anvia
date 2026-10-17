import { Agent } from "@anvia/core/agent";
import {
  Usage,
  type CompletionModelStreamEvent,
  type CompletionResponse,
  type ToolCallPart,
} from "@anvia/core/completion";
import { defineGuardrailPolicy, guardrails } from "@anvia/core/guardrails";
import type { Tool } from "@anvia/core/tool";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpOptions } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
const response = (
  choice: CompletionResponse["choice"],
  finishReason: CompletionResponse["finishReason"] = "stop",
): CompletionResponse => ({
  choice,
  finishReason,
  usage: Usage.empty(),
  rawResponse: { secret: "private-response" },
});
const final = (value: CompletionResponse): CompletionModelStreamEvent => ({
  type: "final",
  response: value,
});
const text = [{ type: "text" as const, text: "hello" }];
const toolCall: ToolCallPart = {
  type: "tool-call",
  toolCallId: "same-id",
  callId: "same-provider-id",
  toolName: "read",
  input: {},
};
const tool: Tool = {
  name: "read",
  definition: () => ({
    name: "read",
    description: "Read fixture",
    parameters: { type: "object", properties: {} },
  }),
  call: () => "private-tool-output",
};

function streamModel(
  turns: Array<Iterable<CompletionModelStreamEvent> | AsyncIterable<CompletionModelStreamEvent>>,
) {
  return {
    ...makeAgent().model,
    capabilities: { ...makeAgent().model.capabilities, streaming: true, reasoning: true },
    async *streamCompletion() {
      const events = turns.shift();
      if (!events) throw new Error("private-missing-turn");
      yield* events;
    },
  };
}
async function peer(options: AcpOptions) {
  const fixture = wireFixture(options);
  cleanup.push(() => fixture.connection.close());
  await fixture.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
  const created = await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] });
  const sessionId = created.result!.sessionId!;
  return {
    ...fixture,
    sessionId,
    prompt: () => fixture.request("session/prompt", { sessionId, prompt: text }),
  };
}

function updates(fixture: ReturnType<typeof wireFixture>) {
  return fixture.responses
    .filter((message) => message.method === "session/update")
    .map((message) => message.params!.update);
}

describe("session/update wire integration", () => {
  it("sends ordered chunks before exactly one prompt response and keeps the turn pending", async () => {
    const gate = deferred();
    const model = streamModel([
      (async function* () {
        yield { type: "text_delta" as const, delta: "hello " };
        await gate.promise;
        yield { type: "text_delta" as const, delta: "world" };
        yield final(response([{ type: "text", text: "hello world" }]));
      })(),
    ]);
    const fixture = await peer({
      sessionFactory: () => ({ agent: new Agent({ id: "fixture", model }) }),
    });
    const pending = fixture.prompt();
    await vi.waitFor(() => expect(updates(fixture)).toHaveLength(1));
    expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(0);
    gate.resolve();
    expect((await pending).result).toEqual({ stopReason: "end_turn" });
    expect(updates(fixture)).toEqual(
      ["hello ", "world"].map((value) => ({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: value },
      })),
    );
    expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
    expect(fixture.responses.at(-1)?.id).toBe(3);
    expect(
      fixture.responses
        .filter((message) => message.method)
        .every((message) => message.params?.sessionId === fixture.sessionId),
    ).toBe(true);
  });

  it("shows final-only text once per generation without replaying streamed text", async () => {
    const fixture = await peer({
      sessionFactory: () => ({
        agent: new Agent({
          id: "final-only",
          tools: [tool],
          model: streamModel([
            [final(response([{ type: "text", text: "before tool" }, toolCall], "tool-calls"))],
            [
              final(
                response([
                  { type: "text", text: "answer" },
                  { type: "text", text: " tail" },
                ]),
              ),
            ],
            [
              { type: "text_delta", delta: "streamed" },
              final(response([{ type: "text", text: "streamed" }])),
            ],
          ]),
        }),
      }),
    });
    expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
    expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
    expect(
      updates(fixture)
        .filter((u) => u.sessionUpdate === "agent_message_chunk")
        .map((u) => u.content),
    ).toEqual(
      ["before tool", "answer", " tail", "streamed"].map((value) => ({
        type: "text",
        text: value,
      })),
    );
  });

  it("keeps tool IDs unique across generations, prompt turns and sessions, with presentation", async () => {
    const fixture = await peer({
      sessionFactory: () => ({
        agent: new Agent({
          id: "fixture",
          tools: [tool],
          model: streamModel(
            Array.from({ length: 2 }, () => [
              [final(response([toolCall], "tool-calls"))],
              [final(response([toolCall], "tool-calls"))],
              [final(response([{ type: "text", text: "done" }]))],
            ]).flat(),
          ),
        }),
        toolPresentation: () => ({
          title: "Read fixture",
          kind: "read",
          locations: [{ path: "file.ts", line: 2 }],
        }),
      }),
    });
    await fixture.prompt();
    await fixture.prompt();
    const second = await fixture.request("session/new", { cwd: process.cwd(), mcpServers: [] });
    await fixture.request("session/prompt", { sessionId: second.result!.sessionId, prompt: text });
    const calls = updates(fixture).filter((u) => u.sessionUpdate === "tool_call");
    const completed = updates(fixture)
      .filter((u) => u.sessionUpdate === "tool_call_update")
      .filter((u) => u.status === "completed");
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((u) => u.toolCallId)).size).toBe(6);
    expect(completed.map((u) => u.toolCallId)).toEqual(calls.map((u) => u.toolCallId));
    expect(updates(fixture)).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        title: "Read fixture",
        kind: "read",
        locations: [{ path: `${process.cwd()}/file.ts`, line: 2 }],
      }),
    );
    expect(JSON.stringify(fixture.responses)).not.toMatch(/private-|same-provider-id/);
  });

  it.each([false, true])(
    "projects completion-only tool results and text (tool throws: %s)",
    async (fails) => {
      const turns = [
        response([toolCall], "tool-calls"),
        response([{ type: "text", text: "done" }]),
      ];
      const fixture = await peer({
        sessionFactory: () => ({
          agent: new Agent({
            id: "fixture",
            tools: [
              {
                ...tool,
                call: () => {
                  if (fails) throw new Error("private-error");
                  return "private-output";
                },
              },
            ],
            model: { ...makeAgent().model, completion: async () => turns.shift()! },
          }),
        }),
      });
      expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
      expect(updates(fixture)).toMatchObject([
        { sessionUpdate: "tool_call" },
        { sessionUpdate: "tool_call_update", status: "pending" },
        { sessionUpdate: "tool_call_update", status: fails ? "failed" : "completed" },
        { sessionUpdate: "agent_message_chunk", content: { text: "done" } },
      ]);
      expect(JSON.stringify(fixture.responses)).not.toContain("private");
    },
  );

  it.each(["stop", "length", "content-filter"] as const)(
    "settles %s exactly once",
    async (finishReason) => {
      const fixture = await peer({
        sessionFactory: () => ({
          agent: new Agent({
            id: "fixture",
            model: streamModel([[final(response([{ type: "text", text: "done" }], finishReason))]]),
          }),
        }),
      });
      expect((await fixture.prompt()).result?.stopReason).toBe(
        { stop: "end_turn", length: "max_tokens", "content-filter": "refusal" }[finishReason],
      );
      expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
    },
  );

  it("maps MaxTurnsError after tool results without a second settlement", async () => {
    const fixture = await peer({
      sessionFactory: () => ({
        agent: new Agent({
          id: "fixture",
          maxTurns: 0,
          tools: [tool],
          model: streamModel([[final(response([toolCall], "tool-calls"))]]),
        }),
      }),
    });
    expect((await fixture.prompt()).result?.stopReason).toBe("max_turn_requests");
    expect(updates(fixture)).toContainEqual(
      expect.objectContaining({ sessionUpdate: "tool_call_update", status: "completed" }),
    );
    expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
  });

  it.each(["input", "output"] as const)(
    "maps %s guardrail blocks to refusal without private details",
    async (boundary) => {
      const policy = defineGuardrailPolicy({
        id: "private-policy",
        [boundary]: [
          guardrails.blockText({
            id: "private-rule",
            boundary,
            patterns: ["hello"],
            reason: "private-reason",
            message: "Request refused",
          }),
        ],
      });
      const fixture = await peer({
        sessionFactory: () => ({
          agent: new Agent({
            id: "fixture",
            guardrails: policy,
            model: streamModel([[{ type: "text_delta", delta: "hello" }, final(response(text))]]),
          }),
        }),
      });
      expect((await fixture.prompt()).result?.stopReason).toBe("refusal");
      expect(updates(fixture)).toEqual(
        boundary === "input"
          ? []
          : [
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Request refused" },
              },
            ],
      );
      expect(JSON.stringify(fixture.responses)).not.toContain("private");
      expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
    },
  );

  it.each([false, true])(
    "does not expose unguarded intermediate text (streaming: %s)",
    async (streaming) => {
      const turns = [
        response([{ type: "text", text: "private-intermediate" }, toolCall], "tool-calls"),
        response([{ type: "text", text: "allowed" }]),
      ];
      const model = streaming
        ? streamModel(turns.map((turn) => [final(turn)]))
        : {
            ...makeAgent().model,
            completion: async () => turns.shift()!,
          };
      const fixture = await peer({
        sessionFactory: () => ({
          agent: new Agent({
            id: "guarded",
            model,
            tools: [tool],
            guardrails: defineGuardrailPolicy({
              id: "policy",
              output: [
                guardrails.blockText({
                  id: "rule",
                  boundary: "output",
                  patterns: ["private"],
                  reason: "private-reason",
                }),
              ],
            }),
          }),
        }),
      });
      expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
      expect(updates(fixture).filter((u) => u.sessionUpdate === "agent_message_chunk")).toEqual([
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "allowed" } },
      ]);
      expect(JSON.stringify(fixture.responses)).not.toContain("private");
    },
  );

  it("keeps rejected final-only output private", async () => {
    const fixture = await peer({
      sessionFactory: () => ({
        agent: new Agent({
          id: "guarded",
          model: streamModel([[final(response([{ type: "text", text: "private-rejected" }]))]]),
          guardrails: defineGuardrailPolicy({
            id: "policy",
            output: [
              guardrails.blockText({
                id: "rule",
                boundary: "output",
                patterns: ["private"],
                reason: "private-reason",
                message: "Request refused",
              }),
            ],
          }),
        }),
      }),
    });
    expect((await fixture.prompt()).result?.stopReason).toBe("refusal");
    expect(updates(fixture)).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Request refused" } },
    ]);
    expect(JSON.stringify(fixture.responses)).not.toContain("private");
  });

  it("sanitizes a mid-stream failure and releases the prompt lock for the next turn", async () => {
    const fixture = await peer({
      sessionFactory: () => ({
        agent: new Agent({
          id: "fixture",
          retries: false,
          model: streamModel([
            (async function* () {
              yield { type: "text_delta" as const, delta: "partial" };
              throw new Error("private-token");
            })(),
            [final(response([{ type: "text", text: "recovered" }]))],
          ]),
        }),
      }),
    });
    expect((await fixture.prompt()).error).toEqual({
      code: -32603,
      message: "Internal error",
      data: { kind: "execution_failed" },
    });
    expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
    expect(fixture.responses.filter((message) => message.id === 3)).toHaveLength(1);
    expect(JSON.stringify(fixture.responses)).not.toContain("private");
  });

  it("forwards opted-in plaintext reasoning through v1", async () => {
    const fixture = await peer({
      reasoning: true,
      sessionFactory: () => ({
        agent: new Agent({
          id: "fixture",
          model: streamModel([
            [
              { type: "reasoning_delta", delta: "thinking", signature: "private-signature" },
              { type: "text_delta", delta: "done" },
              final(
                response([
                  {
                    type: "reasoning",
                    text: "thinking",
                    details: [{ type: "text", text: "thinking", signature: "private-signature" }],
                  },
                  { type: "text", text: "done" },
                ]),
              ),
            ],
          ]),
        }),
      }),
    });
    expect((await fixture.prompt()).result?.stopReason).toBe("end_turn");
    expect(updates(fixture).map((u) => u.sessionUpdate)).toEqual([
      "agent_thought_chunk",
      "agent_message_chunk",
    ]);
    expect(JSON.stringify(fixture.responses)).not.toContain("private");
  });
});
