import type { Message } from "../../src/completion";

export const richMessages = [
  { role: "system", content: "System instructions", metadata: { source: "system" } },
  {
    role: "user",
    metadata: { composer: { entities: [{ id: "document-1" }] } },
    content: [
      { type: "text", text: "Inspect these", signature: "user-signature" },
      {
        type: "image",
        image: { type: "url", url: "https://example.test/image.png" },
        detail: "high",
      },
      {
        type: "image",
        image: { type: "data", data: "aW1hZ2U=" },
        mediaType: "image/png",
        detail: "low",
      },
      {
        type: "file",
        data: { type: "url", url: "https://example.test/report.pdf" },
        mediaType: "application/pdf",
        filename: "report.pdf",
      },
      {
        type: "file",
        data: { type: "data", data: "cmVwb3J0" },
        mediaType: "application/pdf",
        filename: "inline.pdf",
      },
      {
        type: "file",
        data: { type: "text", text: "inline document" },
        mediaType: "text/plain",
      },
    ],
  },
  {
    role: "assistant",
    id: "assistant-1",
    metadata: {
      source: "assistant",
      anvia: {
        generation: {
          provider: "test",
          model: "test-model",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
            totalTokens: 16,
            cachedInputTokens: 3,
            cacheCreationInputTokens: 0,
          },
        },
      },
    },
    content: [
      { type: "text", text: "Working", signature: "assistant-signature" },
      {
        type: "reasoning",
        id: "reasoning-1",
        text: "analysis summary",
        details: [
          { type: "text", text: "analysis", signature: "reasoning-signature" },
          { type: "summary", text: " summary" },
          { type: "encrypted", data: "ciphertext" },
          { type: "redacted", data: "redacted-data" },
        ],
      },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        callId: "call-1",
        toolName: "lookup",
        input: { query: "Anvia", limit: 3 },
        signature: "tool-signature",
      },
      {
        type: "image",
        image: { type: "data", data: "b3V0cHV0" },
        mediaType: "image/png",
        detail: "auto",
      },
    ],
  },
  {
    role: "tool",
    metadata: { source: "tool" },
    content: [
      {
        type: "tool-result",
        toolCallId: "tool-1",
        callId: "call-1",
        toolName: "lookup",
        output: {
          type: "content",
          value: [
            { type: "text", text: "result" },
            {
              type: "file",
              data: { type: "data", data: "cmVzdWx0" },
              mediaType: "image/png",
            },
          ],
        },
      },
    ],
  },
] satisfies readonly Message[];
