import { describe, expect, it } from "vitest";
import { type AssistantContentPart, type ReasoningPart, Usage } from "../src/completion";
import { CompletionStreamAccumulator } from "../src/completion/stream-accumulator";

const encrypted = { type: "encrypted", data: "opaque-reasoning" } as const;
const summary = { type: "summary", text: "Thinking." } as const;
const usage = { ...Usage.empty(), inputTokens: 10, outputTokens: 20, totalTokens: 30 };
const answer = { type: "text", text: "OK" } as const;

describe("CompletionStreamAccumulator terminal reasoning", () => {
  it.each([undefined, [], [encrypted]])(
    "retains final-only reasoning with details %j",
    (details) => {
      const accumulator = new CompletionStreamAccumulator();
      accumulator.accept({ type: "text_delta", delta: "OK" });
      const reasoning: ReasoningPart = {
        type: "reasoning",
        id: "rs-1",
        text: "",
        ...(details === undefined ? {} : { details }),
      };
      complete(accumulator, [reasoning, answer]);

      expect(accumulator.response()).toMatchObject({ choice: [reasoning, answer], usage });
    },
  );

  it("enriches streamed reasoning with final-only encryption", () => {
    const accumulator = summaryAccumulator();
    const reasoning: ReasoningPart = {
      type: "reasoning",
      id: "rs-1",
      text: "Thinking.",
      details: [summary, encrypted],
    };
    complete(accumulator, [reasoning, answer]);

    expect(accumulator.response().choice).toEqual([reasoning, answer]);
  });

  it.each([
    ["text", { text: "Changed." }],
    ["identity", { id: "rs-2" }],
    ["summary", { details: [{ type: "summary", text: "Changed." }, encrypted] }],
    ["detail type", { details: [{ type: "text", text: "Thinking." }, encrypted] }],
  ] satisfies [string, Partial<ReasoningPart>][])(
    "rejects conflicting reasoning %s alongside final-only encryption",
    (_label, change) => {
      const accumulator = summaryAccumulator();
      complete(accumulator, [
        {
          type: "reasoning",
          id: "rs-1",
          text: "Thinking.",
          details: [summary, encrypted],
          ...change,
        },
        answer,
      ]);

      expect(() => accumulator.response()).toThrowError(
        expect.objectContaining({ kind: "invalid-stream-event", usage }),
      );
    },
  );

  it.each(["changed", "omitted"])("rejects %s encryption that was already streamed", (mode) => {
    const accumulator = summaryAccumulator();
    accumulator.accept({
      type: "reasoning_delta",
      id: "rs-1",
      contentType: "encrypted",
      delta: encrypted.data,
    });
    complete(accumulator, [
      {
        type: "reasoning",
        id: "rs-1",
        text: "Thinking.",
        details: mode === "omitted" ? [summary] : [summary, { ...encrypted, data: "changed" }],
      },
      answer,
    ]);

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-stream-event", usage }),
    );
  });

  it("rejects a final-only displayable reasoning part", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({ type: "text_delta", delta: "OK" });
    complete(accumulator, [
      { type: "reasoning", id: "rs-1", text: "Thinking.", details: [summary, encrypted] },
      answer,
    ]);

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-stream-event", usage }),
    );
  });

  it("rejects conflicting tool arguments alongside final-only encrypted reasoning", () => {
    const accumulator = new CompletionStreamAccumulator();
    accumulator.accept({ type: "text_delta", delta: "OK" });
    accumulator.accept({
      type: "tool_call_delta",
      id: "fc-1",
      name: "lookup",
      argumentsDelta: '{"q":1}',
    });
    complete(accumulator, [
      { type: "reasoning", id: "rs-1", text: "", details: [encrypted] },
      answer,
      { type: "tool-call", toolCallId: "fc-1", toolName: "lookup", input: { q: 2 } },
    ]);

    expect(() => accumulator.response()).toThrowError(
      expect.objectContaining({ kind: "invalid-tool-call", toolCallId: "fc-1", usage }),
    );
  });
});

function summaryAccumulator(): CompletionStreamAccumulator {
  const accumulator = new CompletionStreamAccumulator();
  accumulator.accept({
    type: "reasoning_delta",
    id: "rs-1",
    contentType: "summary",
    delta: summary.text,
  });
  accumulator.accept({ type: "text_delta", delta: "OK" });
  return accumulator;
}

function complete(accumulator: CompletionStreamAccumulator, choice: AssistantContentPart[]): void {
  accumulator.accept({
    type: "final",
    response: { choice, usage, rawResponse: {}, finishReason: "stop" },
  });
}
