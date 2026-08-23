import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createMessageSchema,
  getAssistantGenerationMetadata,
  isJsonValue,
  isMessage,
  type JsonValue,
  type Message,
  parseMessage,
  parseMessages,
  reasoningDisplayText,
} from "./helpers/imports";

function CompileMessageBoundary() {
  // @ts-expect-error System messages require string content.
  const invalidSystem = { role: "system", content: [] } satisfies Message;
  const invalidUserContent: Extract<Message, { role: "user" }>["content"] = [
    // @ts-expect-error User messages do not accept reasoning parts.
    { type: "reasoning", text: "private" },
  ];
  // @ts-expect-error Message metadata must be a JSON object.
  const invalidMetadata = { role: "user", content: "hello", metadata: "tenant" } satisfies Message;
  const invalidToolInput = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "lookup",
        // @ts-expect-error Tool inputs must be strict JSON values.
        input: 1n,
      },
    ],
  } satisfies Message;
  const invalidToolOutput = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tool_1",
        toolName: "lookup",
        output: {
          type: "json",
          // @ts-expect-error Tool outputs must use the explicit JSON-safe output union.
          value: undefined,
        },
      },
    ],
  } satisfies Message;
  const providerLeak = {
    role: "user",
    content: "hello",
    // @ts-expect-error additionalParams was removed from the provider-neutral message boundary.
    additionalParams: { cache: true },
  } satisfies Message;
  void [
    invalidSystem,
    invalidUserContent,
    invalidMetadata,
    invalidToolInput,
    invalidToolOutput,
    providerLeak,
  ];
}
void CompileMessageBoundary;

describe("structural messages", () => {
  it("constructs familiar role/content messages without factories", () => {
    const messages = [
      { role: "system", content: "Be concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          {
            type: "image",
            image: { type: "url", url: "https://example.com/image.png" },
            detail: "auto",
          },
          {
            type: "file",
            data: { type: "data", data: "pdf123" },
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        ],
        metadata: { tenantId: "acme" },
      },
    ] satisfies readonly Message[];

    expectTypeOf(messages).toMatchTypeOf<readonly Message[]>();
    expect(parseMessages(messages)).toEqual(messages);
  });

  it("preserves reasoning details, signatures, and provider call identifiers", () => {
    const message = {
      role: "assistant",
      id: "msg_1",
      content: [
        {
          type: "reasoning",
          id: "reasoning_1",
          text: "Checked the plan.",
          details: [
            { type: "summary", text: "Checked the plan." },
            { type: "encrypted", data: "opaque" },
            { type: "text", text: "Visible.", signature: "sig_1" },
            { type: "redacted", data: "redacted" },
          ],
        },
        {
          type: "tool-call",
          toolCallId: "tool_1",
          callId: "provider_call_1",
          toolName: "lookup",
          input: { query: "release" },
          signature: "sig_2",
        },
      ],
    } satisfies Message;

    expect(parseMessage(message)).toEqual(message);
    const reasoning = message.content[0];
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      expect(reasoningDisplayText(reasoning)).toBe("Checked the plan.Visible.");
    }
  });

  it("models explicit tool result outputs", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool_1",
            callId: "provider_call_1",
            toolName: "lookup",
            output: { type: "json", value: { found: true } },
          },
          {
            type: "tool-result",
            toolCallId: "tool_2",
            toolName: "download",
            output: {
              type: "content",
              value: [
                { type: "text", text: "report" },
                {
                  type: "file",
                  data: { type: "data", data: "cGRm" },
                  mediaType: "application/pdf",
                },
              ],
            },
          },
        ],
      },
    ] satisfies readonly Message[];

    expect(parseMessages(messages)).toEqual(messages);
  });
});

describe("message validation", () => {
  it("rejects unknown keys and invalid role/content combinations", () => {
    expect(() => parseMessage({ role: "system", content: [], extra: true })).toThrow();
    expect(() => parseMessage({ role: "tool", content: "done" })).toThrow();
    expect(() =>
      parseMessage({ role: "user", content: [{ type: "reasoning", text: "no" }] }),
    ).toThrow();
    expect(() =>
      parseMessage({ role: "assistant", content: [{ type: "tool-call", input: 1n }] }),
    ).toThrow();
    expect(() =>
      parseMessage({
        role: "user",
        content: [{ type: "image", image: { type: "url", url: "not a URL" } }],
      }),
    ).toThrow();
    expect(() =>
      parseMessage({
        role: "user",
        content: [
          {
            type: "file",
            data: { type: "data", data: "not-base64!" },
            mediaType: "application/pdf",
          },
        ],
      }),
    ).toThrow();
    expect(isMessage({ role: "user", content: "hello" })).toBe(true);
    expect(isMessage({ role: "user", content: "hello", metadata: "tenant" })).toBe(false);
    expect(isMessage({ role: "assistant", id: undefined, content: "hello" })).toBe(false);
    expect(() =>
      parseMessage({
        role: "assistant",
        content: [{ type: "text", text: "hello", signature: undefined }],
      }),
    ).toThrow("strict JSON");
  });

  it("validates application metadata and infers its type", () => {
    const schema = createMessageSchema({
      metadataSchema: z.object({ tenantId: z.string(), priority: z.number().int() }).strict(),
    });
    const message = schema.parse({
      role: "user",
      content: "hello",
      metadata: { tenantId: "acme", priority: 2 },
    });

    expectTypeOf(message.metadata).toEqualTypeOf<
      { tenantId: string; priority: number } | undefined
    >();
    expect(() =>
      schema.parse({ role: "user", content: "hello", metadata: { tenantId: "acme" } }),
    ).toThrow();
  });

  it("round-trips valid strict JSON and rejects lossy structures", () => {
    const message = {
      role: "user",
      content: "hello",
      metadata: { nested: [null, true, 1, "ok"] },
    } satisfies Message;
    expect(parseMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    class JsonArraySubclass extends Array<unknown> {}
    const customPrototypeArray = ["value"];
    Object.setPrototypeOf(customPrototypeArray, { toJSON: () => ["changed"] });
    for (const value of [
      Number.NaN,
      undefined,
      () => {},
      Symbol("value"),
      1n,
      cyclic,
      new Date(),
      new JsonArraySubclass("value"),
      customPrototypeArray,
    ]) {
      expect(isJsonValue(value)).toBe(false);
    }
  });
});

describe("generation metadata", () => {
  it("reads valid framework metadata without accepting inconsistent usage", () => {
    const valid = {
      role: "assistant",
      content: "assistant",
      metadata: {
        anvia: {
          generation: {
            provider: "test",
            modelId: "test-model",
            finishReason: "length",
            providerFinishReason: "max_output_tokens",
            usage: {
              inputTokens: 7,
              outputTokens: 2,
              totalTokens: 9,
              cachedInputTokens: 1,
              cacheCreationInputTokens: 0,
            },
          },
        },
      },
    } satisfies Message;
    expect(getAssistantGenerationMetadata(valid)).toMatchObject({
      provider: "test",
      modelId: "test-model",
      finishReason: "length",
      providerFinishReason: "max_output_tokens",
      usage: { totalTokens: 9 },
    });

    const invalid = structuredClone(valid) as unknown as {
      metadata: { anvia: { generation: { usage: { inputTokens: number } } } };
    };
    invalid.metadata.anvia.generation.usage.inputTokens = -1;
    expect(getAssistantGenerationMetadata(invalid as unknown as Message)).toBeUndefined();
  });

  it("keeps JsonValue metadata compile-time safe", () => {
    const metadata = { tenantId: "acme" } satisfies JsonValue;
    expect(metadata).toEqual({ tenantId: "acme" });
  });
});
