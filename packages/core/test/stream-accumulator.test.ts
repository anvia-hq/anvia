import { describe, expect, it } from "vitest";
import { Usage } from "../src/completion";
import { CompletionStreamAccumulator } from "../src/completion/stream-accumulator";
import { AssistantContent } from "./helpers/imports";

describe("CompletionStreamAccumulator", () => {
  it("returns completed tool call stream events", () => {
    const accumulator = new CompletionStreamAccumulator();
    const toolCall = AssistantContent.toolCall("toolu_1", "Write", {
      file_path: "src/main.tsx",
    });

    expect(accumulator.accept({ type: "tool_call", toolCall })).toEqual({
      type: "tool_call",
      toolCall,
    });
  });

  it("preserves interleaved streamed content order", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "reasoning_delta", id: "r1", delta: "think before" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "text_delta", delta: "answer" });
    accumulator.accept({ type: "reasoning_delta", id: "r2", delta: "think after" });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.reasoning("think before", "r1"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
      AssistantContent.text("answer"),
      AssistantContent.reasoning("think after", "r2"),
    ]);
  });

  it("keeps text parts separated when another part arrives between text deltas", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "text_delta", delta: "before" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "text_delta", delta: "after" });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.text("before"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
      AssistantContent.text("after"),
    ]);
  });

  it("merges adjacent text deltas into one text part", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "text_delta", delta: "hel" });
    accumulator.accept({ type: "text_delta", delta: "lo" });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([AssistantContent.text("hello")]);
  });

  it("uses a complete terminal text snapshot only when it agrees with streamed text", () => {
    const matching = new CompletionStreamAccumulator();
    matching.accept({ type: "text_delta", delta: "complete" });
    matching.accept({
      type: "final",
      response: {
        choice: [AssistantContent.text("complete")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });
    expect(matching.response().choice).toEqual([AssistantContent.text("complete")]);

    const conflicting = new CompletionStreamAccumulator();
    conflicting.accept({ type: "text_delta", delta: "partial" });
    conflicting.accept({
      type: "final",
      response: {
        choice: [AssistantContent.text("complete")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });
    expect(() => conflicting.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-stream-event" }),
    );
  });

  it("preserves non-tool content that exists only in the terminal snapshot", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.text("complete")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([AssistantContent.text("complete")]);
  });

  it("rejects runtime-invalid text and reasoning deltas without coercion", () => {
    const textAccumulator = new CompletionStreamAccumulator();
    expect(() =>
      textAccumulator.accept({ type: "text_delta", delta: { secret: true } } as never),
    ).toThrowError(expect.objectContaining({ kind: "invalid-stream-event" }));

    const reasoningAccumulator = new CompletionStreamAccumulator();
    expect(() =>
      reasoningAccumulator.accept({ type: "reasoning_delta", delta: 42 } as never),
    ).toThrowError(expect.objectContaining({ kind: "invalid-stream-event" }));
  });

  it("rejects runtime-invalid tool argument deltas and modes without coercion", () => {
    const argumentsAccumulator = new CompletionStreamAccumulator();
    expect(() =>
      argumentsAccumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        name: "lookup",
        argumentsDelta: 123,
      } as never),
    ).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-arguments", toolCallId: "tool_0" }),
    );

    const modeAccumulator = new CompletionStreamAccumulator();
    expect(() =>
      modeAccumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        name: "lookup",
        argumentsDelta: "{}",
        argumentsMode: "merge",
      } as never),
    ).toThrowError(expect.objectContaining({ kind: "invalid-stream-event", toolCallId: "tool_0" }));
  });

  it("rejects conflicting argument snapshots and deltas after a snapshot", () => {
    const conflicting = new CompletionStreamAccumulator();
    conflicting.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      argumentsDelta: '{"query":"first"}',
      argumentsMode: "replace",
    });
    expect(() =>
      conflicting.accept({
        type: "tool_call_delta",
        id: "tool_0",
        argumentsDelta: '{"query":"second"}',
        argumentsMode: "replace",
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call" }));

    const postSnapshot = new CompletionStreamAccumulator();
    postSnapshot.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      argumentsDelta: "{}",
      argumentsMode: "replace",
    });
    expect(() =>
      postSnapshot.accept({
        type: "tool_call_delta",
        id: "tool_0",
        argumentsDelta: " ",
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call" }));
  });

  it("rejects an empty provider stream without a terminal response", () => {
    const accumulator = new CompletionStreamAccumulator();

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "incomplete-stream" }),
    );
  });

  it("rejects a partial text stream without a terminal response", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({ type: "text_delta", delta: "partial" });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "incomplete-stream" }),
    );
  });

  it("merges same-id reasoning deltas at the reasoning part's first position", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "reasoning_delta", id: "r1", delta: "one" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "reasoning_delta", id: "r1", delta: " two" });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.reasoning("one two", "r1"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
    ]);
  });

  it("keeps separated id-less reasoning deltas as separate reasoning parts", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "reasoning_delta", delta: "before" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "reasoning_delta", delta: "after" });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.reasoning("before"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
      AssistantContent.reasoning("after"),
    ]);
  });

  it("keeps tool calls at their first-seen position while accumulating later argument deltas", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "tool_call_delta", id: "tool_1", name: "lookup" });
    accumulator.accept({ type: "text_delta", delta: "checking" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      argumentsDelta: '{"query":"x"}',
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
      AssistantContent.text("checking"),
    ]);
  });

  it("assembles valid JSON tool arguments across multiple fragments", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "ExecCommand",
      argumentsDelta: '{"command":',
    });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      argumentsDelta: '"pwd"}',
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }),
    ]);
  });

  it("replaces accumulated tool arguments with a completed snapshot", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "ExecCommand",
      argumentsDelta: '{"command":',
    });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      argumentsDelta: '{"command":"pwd"}',
      argumentsMode: "replace",
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }),
    ]);
  });

  it("preserves valid scalar JSON tool arguments", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "Echo",
      argumentsDelta: '"hello"',
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "Echo", "hello"),
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t"],
  ])("rejects %s streamed tool arguments", (_label, argumentsDelta) => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "NoOp",
      argumentsDelta,
    });
    finish(accumulator);

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({
        kind: "malformed-tool-arguments",
        toolCallId: "tool_0",
      }),
    );
  });

  it("rejects a complete-looking tool call when the provider stream has no terminal event", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      argumentsDelta: '{"query":"anvia"}',
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({
        kind: "incomplete-tool-call",
        toolCallId: "tool_0",
      }),
    );
  });

  it("rejects blank continuation metadata instead of silently discarding it", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "call_abc",
      name: "ExecCommand",
    });
    expect(() =>
      accumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        callId: "",
        name: "",
        argumentsDelta: '{"command":"pwd"}',
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call" }));
  });

  it("preserves accumulated order when the final choice is empty", () => {
    const accumulator = new CompletionStreamAccumulator();
    const rawResponse = { provider: "test" };

    accumulator.accept({ type: "message_id", id: "stream_msg" });
    accumulator.accept({ type: "reasoning_delta", id: "r1", delta: "think" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "text_delta", delta: "answer" });
    accumulator.accept({
      type: "final",
      response: {
        choice: [],
        usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        rawResponse,
        messageId: "final_msg",
      },
    });

    expect(accumulator.response()).toEqual({
      choice: [
        AssistantContent.reasoning("think", "r1"),
        AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
        AssistantContent.text("answer"),
      ],
      usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      rawResponse,
      messageId: "final_msg",
    });
  });

  it("uses authoritative final order when its non-tool content agrees with the stream", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "reasoning_delta", id: "r1", delta: "think" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
    });
    accumulator.accept({ type: "text_delta", delta: "answer" });
    accumulator.accept({
      type: "final",
      response: {
        choice: [
          AssistantContent.text("answer"),
          AssistantContent.reasoning("think", "r1"),
          AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
        ],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.text("answer"),
      AssistantContent.reasoning("think", "r1"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
    ]);
  });

  it("accepts matching final tool arguments when object key order differs", () => {
    const accumulator = new CompletionStreamAccumulator();
    const rawResponse = { provider: "test" };
    const finalInput = {
      options: { modes: ["safe", "fast"], overwrite: true },
      file_path: "src/main.tsx",
    };

    accumulator.accept({
      type: "tool_call_delta",
      id: "toolu_1",
      name: "Write",
      argumentsDelta:
        '{"file_path":"src/main.tsx","options":{"overwrite":true,"modes":["safe","fast"]}}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("toolu_1", "Write", finalInput)],
        usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        rawResponse,
      },
    });

    const response = accumulator.response();
    expect(response).toEqual({
      choice: [
        AssistantContent.toolCall("toolu_1", "Write", {
          file_path: "src/main.tsx",
          options: { overwrite: true, modes: ["safe", "fast"] },
        }),
      ],
      usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      rawResponse,
    });
    expect(response.choice[0]?.type === "tool-call" && response.choice[0].input).not.toBe(
      finalInput,
    );
  });

  it("rejects a changed tool call id even when the provider call id is stable", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      callId: "call_1",
      name: "Write",
      argumentsDelta: '{"file_path":"src/main.tsx","content":"hello"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [
          AssistantContent.toolCall(
            "provider_tool_1",
            "Write",
            { content: "hello", file_path: "src/main.tsx" },
            "call_1",
          ),
        ],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "tool_1" }),
    );
  });

  it("rejects a non-empty final snapshot that omits streamed non-tool content", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({ type: "text_delta", delta: "answer" });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("tool_1", "lookup", { query: "x" })],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-stream-event" }),
    );
  });

  it.each([
    ["null", null],
    ["blank string", "  "],
    ["empty array", []],
    ["empty object", {}],
    ["false", false],
    ["zero", 0],
    ["different object", { query: "different" }],
  ])("rejects %s final tool arguments that disagree with streamed arguments", (_label, input) => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"anvia"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("tool_1", "lookup", input)],
        usage: { ...Usage.empty(), outputTokens: 4, totalTokens: 4 },
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({
        kind: "invalid-tool-call",
        toolCallId: "tool_1",
        usage: expect.objectContaining({ outputTokens: 4, totalTokens: 4 }),
      }),
    );
  });

  it("rejects malformed streamed tool arguments during response finalization", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "call_abc",
      name: "ExecCommand",
      argumentsDelta: '{"command":"pwd"',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrow(
      'Completion provider returned tool call "tool_0" with malformed JSON arguments.',
    );
  });

  it.each([
    ["cumulative", ["{", '{"command":"pwd"}']],
    ["duplicated final fragment", ['{"command":"pwd"', "}", "}"]],
  ])("rejects %s streamed tool arguments", (_label, fragments) => {
    const accumulator = new CompletionStreamAccumulator();
    for (const argumentsDelta of fragments) {
      accumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_abc",
        name: "ExecCommand",
        argumentsDelta,
      });
    }
    finish(accumulator);

    expect(() => accumulator.response()).toThrow(
      'Completion provider returned tool call "tool_0" with malformed JSON arguments.',
    );
  });

  it("rejects parsed arguments that are not valid JSON values", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "calculate",
      argumentsDelta: '{"value":1e400}',
    });
    finish(accumulator);

    expect(() => accumulator.response()).toThrow(
      'Completion provider returned tool call "tool_0" with arguments that are not a JSON value.',
    );
  });

  it("rejects conflicting streamed tool identities", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "call_0",
      name: "lookup",
    });

    expect(() =>
      accumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        callId: "call_1",
        name: "delete_all",
      }),
    ).toThrow('Completion provider returned an invalid tool call "tool_0".');
  });

  it("rejects conflicting streamed tool signatures", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      signature: "signature_1",
    });

    expect(() =>
      accumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        signature: "signature_2",
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call" }));
  });

  it("preserves a streamed signature when the matching full call omits it", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      argumentsDelta: "{}",
      signature: "signature_1",
    });
    accumulator.accept({
      type: "tool_call",
      toolCall: AssistantContent.toolCall("tool_0", "lookup", {}),
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      { ...AssistantContent.toolCall("tool_0", "lookup", {}), signature: "signature_1" },
    ]);
  });

  it.each([
    ["blank provider call id", { callId: " " }],
    ["blank tool name", { name: "\t" }],
  ])("rejects a %s instead of silently discarding it", (_label, identity) => {
    const accumulator = new CompletionStreamAccumulator();

    expect(() =>
      accumulator.accept({
        type: "tool_call_delta",
        id: "tool_0",
        ...identity,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid-tool-call" }));
  });

  it("rejects final tool identity changes before execution", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "call_0",
      name: "lookup",
      argumentsDelta: '{"query":"anvia"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("tool_0", "delete_all", { query: "anvia" }, "call_0")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "tool_0" }),
    );
  });

  it("rejects malformed streamed arguments even when the final snapshot is valid", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "ExecCommand",
      argumentsDelta: '{"command":"pwd"',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" })],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({
        kind: "malformed-tool-arguments",
        toolCallId: "tool_0",
      }),
    );
  });

  it("rejects a full tool-call snapshot that conflicts with streamed arguments", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "lookup",
      argumentsDelta: '{"query":"first"}',
    });

    expect(() =>
      accumulator.accept({
        type: "tool_call",
        toolCall: AssistantContent.toolCall("tool_0", "lookup", { query: "second" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "invalid-tool-call",
        toolCallId: "tool_0",
      }),
    );
  });

  it("rejects duplicate full tool-call snapshots", () => {
    const accumulator = new CompletionStreamAccumulator();
    const toolCall = AssistantContent.toolCall("tool_0", "lookup", { query: "anvia" });
    accumulator.accept({ type: "tool_call", toolCall });

    expect(() => accumulator.accept({ type: "tool_call", toolCall })).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "tool_0" }),
    );
  });

  it("accepts a full tool-call snapshot after an identity-only delta", () => {
    const accumulator = new CompletionStreamAccumulator();
    const toolCall = AssistantContent.toolCall("tool_0", "lookup", {});
    accumulator.accept({ type: "tool_call_delta", id: "tool_0", name: "lookup" });

    expect(accumulator.accept({ type: "tool_call", toolCall })).toEqual({
      type: "tool_call",
      toolCall,
    });
    finish(accumulator);
    expect(accumulator.response().choice).toEqual([toolCall]);
  });

  it("preserves structured reasoning segments in their streamed order", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "reasoning_delta",
      id: "reasoning_1",
      contentType: "text",
      delta: "analysis",
      signature: "signature_1",
    });
    accumulator.accept({
      type: "reasoning_delta",
      id: "reasoning_1",
      contentType: "summary",
      delta: "summary",
    });
    accumulator.accept({
      type: "reasoning_delta",
      id: "reasoning_1",
      contentType: "encrypted",
      delta: "ciphertext",
    });
    accumulator.accept({
      type: "reasoning_delta",
      id: "reasoning_1",
      contentType: "redacted",
      delta: "redacted-data",
    });
    finish(accumulator);

    expect(accumulator.response().choice).toEqual([
      {
        type: "reasoning",
        id: "reasoning_1",
        text: "analysissummary",
        details: [
          { type: "text", text: "analysis", signature: "signature_1" },
          { type: "summary", text: "summary" },
          { type: "encrypted", data: "ciphertext" },
          { type: "redacted", data: "redacted-data" },
        ],
      },
    ]);
  });

  it("uses a streamed message id only when the final response omits one", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({ type: "message_id", id: "stream_message" });
    accumulator.accept({ type: "text_delta", delta: "answer" });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.text("answer")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response()).toMatchObject({ messageId: "stream_message" });
  });
});

function finish(accumulator: CompletionStreamAccumulator): void {
  accumulator.accept({
    type: "final",
    response: {
      choice: [],
      usage: Usage.empty(),
      rawResponse: {},
    },
  });
}
