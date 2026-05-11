import { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import {
  jsonSyntaxTokens,
  plainTraceValue,
  rawTraceJson,
} from "../src/ui/app/modules/tracing/trace-browser";

describe("trace browser metadata formatting", () => {
  it("keeps scalar metadata labels instead of collapsing them to Value", () => {
    expect(plainTraceValue("Metadata", { agentName: "Support Operations" })).toEqual([
      { label: "Agent Name", text: "Support Operations" },
    ]);
  });

  it("formats metadata as raw JSON", () => {
    expect(rawTraceJson({ agentName: "Support Operations", toolCount: 1 })).toBe(
      '{\n  "agentName": "Support Operations",\n  "toolCount": 1\n}',
    );
  });

  it("classifies JSON tokens for syntax highlighting", () => {
    expect(
      jsonSyntaxTokens('{"agentName":"Support Operations","toolCount":1,"active":true}').map(
        ({ text, type }) => ({ text, type }),
      ),
    ).toEqual([
      { text: "{", type: "plain" },
      { text: '"agentName"', type: "key" },
      { text: ":", type: "plain" },
      { text: '"Support Operations"', type: "string" },
      { text: ",", type: "plain" },
      { text: '"toolCount"', type: "key" },
      { text: ":", type: "plain" },
      { text: "1", type: "number" },
      { text: ",", type: "plain" },
      { text: '"active"', type: "key" },
      { text: ":", type: "plain" },
      { text: "true", type: "boolean" },
      { text: "}", type: "plain" },
    ]);
  });

  it("does not show raw response instructions or usage in output rows", () => {
    expect(
      plainTraceValue("Output", {
        choice: [{ type: "text", text: "Hey! How can I help?" }],
        usage: { inputTokens: 69, outputTokens: 11, totalTokens: 80 },
        rawResponse: {
          instructions: "Use tools when useful.",
        },
        messageId: "resp_123",
      }),
    ).toEqual([
      { label: "Assistant output", text: "Hey! How can I help?" },
      { label: "Message Id", text: "resp_123" },
    ]);
  });

  it("groups chat history separately from the current prompt", () => {
    expect(
      plainTraceValue("Input", {
        instructions: "Use tools when useful.",
        chatHistory: [
          Message.user("Hello!"),
          Message.assistant("Hello! How can I help you today?"),
          Message.user("What tools do you have?"),
        ],
      }),
    ).toEqual([
      { label: "System prompt", text: "Use tools when useful." },
      {
        label: "Conversation history (2)",
        text: "1. User\nHello!\n\n2. Assistant\nHello! How can I help you today?",
      },
      { label: "Current prompt", text: "What tools do you have?" },
    ]);
  });

  it("groups agent run history while keeping the prompt separate", () => {
    expect(
      plainTraceValue("Input", {
        instructions: "Use tools when useful.",
        history: [Message.user("Hello!"), Message.assistant("Hello! How can I help you today?")],
        prompt: Message.user("Get ORDER 11001"),
      }),
    ).toEqual([
      { label: "System prompt", text: "Use tools when useful." },
      {
        label: "Conversation history (2)",
        text: "1. User\nHello!\n\n2. Assistant\nHello! How can I help you today?",
      },
      { label: "Current prompt", text: "Get ORDER 11001" },
    ]);
  });
});
