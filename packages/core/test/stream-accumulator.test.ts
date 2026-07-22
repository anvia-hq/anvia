import { describe, expect, it } from "vitest";
import { AssistantContent, Usage } from "../src/completion";
import { CompletionStreamAccumulator } from "../src/internal/prompt-runtime/stream-accumulator";

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

    expect(accumulator.response().choice).toEqual([AssistantContent.text("hello")]);
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

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "Echo", "hello"),
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t"],
  ])("normalizes %s streamed tool arguments to an empty object", (_label, argumentsDelta) => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      name: "NoOp",
      argumentsDelta,
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "NoOp", {}),
    ]);
  });

  it("does not replace accumulated tool metadata with empty continuation placeholders", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "call_abc",
      name: "ExecCommand",
    });
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_0",
      callId: "",
      name: "",
      argumentsDelta: '{"command":"pwd"}',
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }, "call_abc"),
    ]);
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

  it("uses stream order when a non-empty final choice is grouped differently", () => {
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
          AssistantContent.toolCall("tool_1", "lookup", {}),
        ],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.reasoning("think", "r1"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
      AssistantContent.text("answer"),
    ]);
  });

  it("preserves accumulated streamed tool arguments when the final tool input is empty", () => {
    const accumulator = new CompletionStreamAccumulator();
    const rawResponse = { provider: "minimax" };

    accumulator.accept({
      type: "message_id",
      id: "msg_1",
    });
    accumulator.accept({
      type: "tool_call_delta",
      id: "toolu_1",
      name: "Write",
    });
    accumulator.accept({
      type: "tool_call_delta",
      id: "toolu_1",
      argumentsDelta: '{"file_path":"src/main.tsx","content":"hello"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("toolu_1", "Write", {})],
        usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        rawResponse,
        messageId: "msg_1",
      },
    });

    expect(accumulator.response()).toEqual({
      choice: [
        AssistantContent.toolCall("toolu_1", "Write", {
          file_path: "src/main.tsx",
          content: "hello",
        }),
      ],
      usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      rawResponse,
      messageId: "msg_1",
    });
  });

  it("preserves accumulated start-block tool input when the final tool input is empty", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "toolu_1",
      name: "Write",
      argumentsDelta: '{"file_path":"src/main.tsx","content":"hello"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("toolu_1", "Write", {})],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("toolu_1", "Write", {
        file_path: "src/main.tsx",
        content: "hello",
      }),
    ]);
  });

  it("keeps non-empty final tool arguments over accumulated streamed arguments", () => {
    const accumulator = new CompletionStreamAccumulator();

    accumulator.accept({
      type: "tool_call_delta",
      id: "toolu_1",
      name: "Write",
      argumentsDelta: '{"file_path":"src/main.tsx","content":"streamed"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [
          AssistantContent.toolCall("toolu_1", "Write", {
            file_path: "src/main.tsx",
            content: "final",
          }),
        ],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("toolu_1", "Write", {
        file_path: "src/main.tsx",
        content: "final",
      }),
    ]);
  });

  it("fills empty final tool arguments by matching accumulated calls by provider call id", () => {
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
        choice: [AssistantContent.toolCall("provider_tool_1", "Write", {}, "call_1")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall(
        "provider_tool_1",
        "Write",
        {
          file_path: "src/main.tsx",
          content: "hello",
        },
        "call_1",
      ),
    ]);
  });

  it("appends final-only tool calls after accumulated streamed parts", () => {
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

    expect(accumulator.response().choice).toEqual([
      AssistantContent.text("answer"),
      AssistantContent.toolCall("tool_1", "lookup", { query: "x" }),
    ]);
  });

  it.each([
    ["null", null],
    ["blank string", "  "],
    ["empty array", []],
    ["empty object", {}],
  ])("uses streamed arguments when final tool arguments are %s", (_label, finalArguments) => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({
      type: "tool_call_delta",
      id: "tool_1",
      callId: "call_1",
      name: "lookup",
      signature: "signed",
      argumentsDelta: '{"query":"anvia"}',
    });
    accumulator.accept({
      type: "final",
      response: {
        choice: [AssistantContent.toolCall("tool_1", "lookup", finalArguments, "call_1")],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      {
        type: "tool_call",
        id: "tool_1",
        callId: "call_1",
        signature: "signed",
        function: { name: "lookup", arguments: { query: "anvia" } },
      },
    ]);
  });

  it.each([
    ["false", false],
    ["zero", 0],
  ])("keeps meaningful scalar final tool arguments for %s", (_label, finalArguments) => {
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
        choice: [AssistantContent.toolCall("tool_1", "lookup", finalArguments)],
        usage: Usage.empty(),
        rawResponse: {},
      },
    });

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_1", "lookup", finalArguments),
    ]);
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
      'Completion returned tool call "tool_0" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
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

    expect(() => accumulator.response()).toThrow(
      'Completion returned tool call "tool_0" with malformed JSON arguments; this indicates invalid provider output or incomplete stream assembly.',
    );
  });

  it("uses a valid completed tool call when streamed argument fragments are malformed", () => {
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

    expect(accumulator.response().choice).toEqual([
      AssistantContent.toolCall("tool_0", "ExecCommand", { command: "pwd" }),
    ]);
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

    expect(accumulator.response().choice).toEqual([
      {
        type: "reasoning",
        id: "reasoning_1",
        text: "analysissummary",
        content: [
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
