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
});
