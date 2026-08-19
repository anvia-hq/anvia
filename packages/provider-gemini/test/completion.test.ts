import { Agent, type Tool } from "@anvia/core";
import {
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionRequest,
} from "@anvia/core/completion";
import { GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import {
  fromGeminiGenerateContentResponse,
  fromGeminiGenerateContentStreamChunk,
  GeminiCompletionModel,
  messagesToGeminiContents,
  toGeminiGenerateContentParams,
} from "../src/gemini/completion";
import { GeminiClient } from "../src/index";

describe("Gemini completion mapping", () => {
  it("exposes Gemini capability metadata", () => {
    const model = new GeminiCompletionModel({} as never, "gemini-test");

    expect(model.provider).toBe("gemini");
    expect(model.modelId).toBe("gemini-test");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: true,
    });
  });

  it("exposes model-specific context limits", () => {
    const model = new GeminiCompletionModel({} as never, "gemini-2.5-flash", {
      contextWindow: 1_048_576,
      maxInputTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });

    expect(model.contextLimits).toEqual({
      contextWindow: 1_048_576,
      maxInputTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });
  });

  it("sends image input to the provider", async () => {
    const calls: unknown[] = [];
    const model = new GeminiCompletionModel(
      {
        models: {
          generateContent: async (params: unknown) => {
            calls.push(params);
            return { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
          },
        },
      } as never,
      "gemini-test",
    );

    await model.completion({
      chatHistory: [Message.user([UserContent.imageUrl("https://example.com/a.png")])],
      documents: [],
      tools: [],
    });

    expect(calls[0]).toMatchObject({
      model: "gemini-test",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: "https://example.com/a.png",
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
    });
  });

  it("summarizes provider request metadata for traces", () => {
    const model = new GeminiCompletionModel({} as never, "gemini-test");
    const request: CompletionRequest = {
      instructions: "Be concise.",
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [{ name: "add", description: "Add numbers", parameters: { type: "object" } }],
      maxTokens: 128,
      toolChoice: "auto",
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "gemini",
      api: "models.generateContentStream",
      stream: true,
      model: "gemini-test",
      contentCount: 1,
      toolCount: 1,
      toolNames: ["add"],
      hasSystemInstruction: true,
      parameterKeys: expect.arrayContaining(["config", "contents", "model"]),
    });
  });

  it("maps normalized requests to Gemini generateContent params", () => {
    const request: CompletionRequest = {
      instructions: "Use the support policy.",
      chatHistory: [
        Message.system("System context."),
        Message.user("What is the order status?", {
          metadata: { composer: { entities: [] } },
        }),
        Message.assistant([AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" })]),
        Message.tool(ToolContent.toolResult("call_1", "shipped", { toolName: "lookup_order" })),
      ],
      documents: [{ id: "policy", text: "Refunds take 5 days." }],
      tools: [
        { name: "lookup_order", description: "Look up an order.", parameters: { type: "object" } },
      ],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: { type: "function", name: "lookup_order" },
      outputSchema: { type: "object", title: "OrderAnswer" },
      providerOptions: {
        labels: { surface: "test" },
        config: {
          httpOptions: {
            headers: { "x-request-source": "test" },
            retryOptions: { attempts: 7, maxDelay: 30 },
          },
          topP: 0.9,
          temperature: 0.4,
        },
      },
    };

    expect(toGeminiGenerateContentParams("gemini-2.5-flash", request)).toEqual({
      model: "gemini-2.5-flash",
      labels: { surface: "test" },
      config: {
        httpOptions: {
          headers: { "x-request-source": "test" },
          retryOptions: { attempts: 1, maxDelay: 30 },
        },
        systemInstruction: "Use the support policy.\n\nSystem context.",
        temperature: 0.2,
        maxOutputTokens: 128,
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup_order",
                description: "Look up an order.",
                parametersJsonSchema: { type: "object" },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: ["lookup_order"],
          },
        },
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object", title: "OrderAnswer" },
        topP: 0.9,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "<file id: policy>\nRefunds take 5 days.\n</file>\n" }],
        },
        { role: "user", parts: [{ text: "What is the order status?" }] },
        {
          role: "model",
          parts: [{ functionCall: { name: "lookup_order", args: { id: "A1" } } }],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "lookup_order",
                response: { content: "shipped" },
              },
            },
          ],
        },
      ],
    });
  });

  it("rejects a non-object providerOptions.config", () => {
    expect(() =>
      toGeminiGenerateContentParams("gemini-2.5-flash", {
        chatHistory: [Message.user("hello")],
        documents: [],
        tools: [],
        providerOptions: { config: [] },
      }),
    ).toThrow("Gemini providerOptions.config must be a JSON object.");
  });

  it("preserves Gemini thought signatures in assistant history", () => {
    const toolCall = {
      ...AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" }),
      signature: "tool_sig",
    };
    expect(
      messagesToGeminiContents([
        Message.assistant([
          { ...AssistantContent.text("Answer."), signature: "text_sig" },
          AssistantContent.reasoningFromContent([
            { type: "summary", text: "Thought summary." },
            { type: "text", text: "Thinking.", signature: "reasoning_sig" },
          ]),
          toolCall,
        ]),
      ]),
    ).toEqual([
      {
        role: "model",
        parts: [
          { text: "Answer.", thoughtSignature: "text_sig" },
          { text: "Thought summary.", thought: true },
          { text: "Thinking.", thought: true, thoughtSignature: "reasoning_sig" },
          {
            functionCall: { name: "lookup_order", args: { id: "A1" } },
            thoughtSignature: "tool_sig",
          },
        ],
      },
    ]);
  });

  it("maps failed and denied tool results to function-response errors", () => {
    expect(
      messagesToGeminiContents([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool_error",
              toolName: "lookup",
              output: { type: "error-json", value: { code: "FAILED" } },
            },
            {
              type: "tool-result",
              toolCallId: "tool_denied",
              toolName: "delete",
              output: { type: "execution-denied", reason: "Not allowed." },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "lookup",
              response: { error: { code: "FAILED" } },
            },
          },
          {
            functionResponse: {
              name: "delete",
              response: { error: "Not allowed." },
            },
          },
        ],
      },
    ]);
  });

  it("maps image and document attachments for v1", () => {
    expect(
      messagesToGeminiContents([
        Message.user([
          UserContent.imageUrl("https://example.com/a.jpg"),
          UserContent.imageBase64("abc123", "image/webp"),
          UserContent.documentText("Plain document text."),
          UserContent.documentBase64("pdf123", "application/pdf", { filename: "report.pdf" }),
          UserContent.documentUrl("https://example.com/a.pdf", "application/pdf"),
        ]),
      ]),
    ).toEqual([
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: "https://example.com/a.jpg",
              mimeType: "image/jpeg",
            },
          },
          {
            inlineData: {
              mimeType: "image/webp",
              data: "abc123",
            },
          },
          { text: "Plain document text." },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: "pdf123",
            },
          },
          {
            fileData: {
              fileUri: "https://example.com/a.pdf",
              mimeType: "application/pdf",
            },
          },
        ],
      },
    ]);
  });

  it("maps Gemini responses to normalized completion responses", () => {
    const response = fromGeminiGenerateContentResponse({
      responseId: "response-1",
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "Use a reset link." },
              { text: "Checked policy.", thought: true },
              { functionCall: { id: "call-1", name: "lookup_order", args: { id: "A1" } } },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 2,
        toolUsePromptTokenCount: 2,
        totalTokenCount: 11,
        cachedContentTokenCount: 1,
      },
    });

    expect(response.messageId).toBe("response-1");
    expect(response.choice).toEqual([
      AssistantContent.text("Use a reset link."),
      AssistantContent.reasoningSummary("Checked policy."),
      AssistantContent.toolCall("call-1", "lookup_order", { id: "A1" }, "call-1"),
    ]);
    expect(response.usage).toMatchObject({
      inputTokens: 5,
      outputTokens: 6,
      totalTokens: 11,
      cachedInputTokens: 1,
      details: {
        input: 2,
        input_cached_tokens: 1,
        input_tool_use_tokens: 2,
        output: 4,
        output_reasoning_tokens: 2,
        total: 11,
      },
    });
  });

  it("maps Gemini token limits to the normalized length reason", () => {
    const response = fromGeminiGenerateContentResponse({
      candidates: [
        {
          index: 0,
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: '{"answer":"partial' }] },
        },
      ],
      usageMetadata: {},
    });

    expect(response).toMatchObject({
      finishReason: "length",
      providerFinishReason: "MAX_TOKENS",
    });
  });

  it("gives Gemini terminal failures precedence over inferred tool-call completion", () => {
    expectProviderOutputError(
      () =>
        fromGeminiGenerateContentResponse({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: {
                parts: [{ functionCall: { id: "call-1", name: "lookup", args: { id: "A1" } } }],
              },
            },
          ],
          usageMetadata: {},
        }),
      { kind: "truncated-tool-call", finishReason: "length" },
    );
    expectProviderOutputError(
      () =>
        fromGeminiGenerateContentResponse({
          candidates: [
            {
              finishReason: "IMAGE_PROHIBITED_CONTENT",
              content: {
                parts: [{ functionCall: { id: "call-2", name: "lookup", args: { id: "A2" } } }],
              },
            },
          ],
          usageMetadata: {},
        }),
      { kind: "filtered-tool-call", finishReason: "content-filter" },
    );
  });

  it("infers Gemini tool-call completion only from a normal stop", () => {
    const response = fromGeminiGenerateContentResponse({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ functionCall: { id: "call-1", name: "lookup", args: { id: "A1" } } }],
          },
        },
      ],
      usageMetadata: {},
    });

    expect(response).toMatchObject({
      finishReason: "tool-calls",
      providerFinishReason: "STOP",
    });
  });

  it("maps Gemini streaming chunks", () => {
    expect(
      fromGeminiGenerateContentStreamChunk({
        responseId: "response-1",
        candidates: [{ content: { parts: [{ text: "Hello" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    ).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "message_id", id: "response-1" },
      {
        type: "final",
        response: expect.objectContaining({
          messageId: "response-1",
          choice: [AssistantContent.text("Hello")],
        }),
      },
    ]);
  });

  it("marks streamed Gemini tool arguments as replacement snapshots", () => {
    expect(
      fromGeminiGenerateContentStreamChunk({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: "call-1",
                    name: "write_file",
                    args: { path: "README.md" },
                  },
                  thoughtSignature: "tool_sig",
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        type: "tool_call_delta",
        id: "call-1",
        callId: "call-1",
        name: "write_file",
        signature: "tool_sig",
      },
      {
        type: "tool_call_delta",
        id: "call-1",
        callId: "call-1",
        argumentsDelta: '{"path":"README.md"}',
        argumentsMode: "replace",
      },
    ]);
  });

  it("reads only SDK candidate zero without invoking text/function-call getters", () => {
    const response = sdkResponse({
      candidates: [
        {
          index: 1,
          content: {
            parts: [{ functionCall: { name: "lookup", args: { source: "alternate" } } }],
          },
        },
        {
          index: 0,
          finishReason: "STOP",
          content: {
            parts: [
              { functionCall: { name: "lookup", args: { source: "primary-one" } } },
              { functionCall: { name: "lookup", args: { source: "primary-two" } } },
            ],
          },
        },
      ],
      usageMetadata: {},
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const events = fromGeminiGenerateContentStreamChunk(response);
      expect(events.filter((event) => event.type === "tool_call_delta")).toEqual([
        {
          type: "tool_call_delta",
          id: "gemini-tool-0",
          name: "lookup",
        },
        {
          type: "tool_call_delta",
          id: "gemini-tool-0",
          argumentsDelta: '{"source":"primary-one"}',
          argumentsMode: "replace",
        },
        {
          type: "tool_call_delta",
          id: "gemini-tool-1",
          name: "lookup",
        },
        {
          type: "tool_call_delta",
          id: "gemini-tool-1",
          argumentsDelta: '{"source":"primary-two"}',
          argumentsMode: "replace",
        },
      ]);
      expect(finalResponseFrom(events).choice).toEqual([
        AssistantContent.toolCall("gemini-tool-0", "lookup", { source: "primary-one" }),
        AssistantContent.toolCall("gemini-tool-1", "lookup", { source: "primary-two" }),
      ]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects ambiguous unindexed primary candidates", () => {
    expectProviderOutputError(
      () =>
        fromGeminiGenerateContentResponse({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: "lookup", args: { source: "first" } } }],
              },
            },
            {
              content: {
                parts: [{ functionCall: { name: "lookup", args: { source: "second" } } }],
              },
            },
          ],
          usageMetadata: {},
        }),
      { kind: "invalid-tool-call" },
    );
  });

  it.each([
    ["sole alternate", 1],
    ["non-numeric", "0"],
    ["negative", -1],
  ])("rejects a %s primary candidate index", (_label, index) => {
    expectProviderOutputError(
      () =>
        fromGeminiGenerateContentResponse({
          candidates: [{ index, finishReason: "STOP", content: { parts: [{ text: "ignored" }] } }],
          usageMetadata: {},
        }),
      { kind: "invalid-tool-call" },
    );
  });

  it("rejects non-JSON native Gemini tool arguments", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const [label, args] of [
      ["undefined", undefined],
      ["null", null],
      ["string", "query"],
      ["array", ["query"]],
      ["non-finite", Number.POSITIVE_INFINITY],
      ["nested undefined", { query: undefined }],
      ["cyclic", cyclic],
    ] as const) {
      expectProviderOutputError(
        () =>
          fromGeminiGenerateContentResponse({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [{ functionCall: { id: `call-${label}`, name: "lookup", args } }],
                },
              },
            ],
            usageMetadata: {},
          }),
        { kind: "invalid-tool-arguments", toolCallId: `call-${label}` },
      );
    }
  });

  it.each([
    ["MALFORMED_FUNCTION_CALL", "malformed-tool-arguments"],
    ["UNEXPECTED_TOOL_CALL", "invalid-tool-call"],
    ["TOO_MANY_TOOL_CALLS", "invalid-tool-call"],
  ] as const)("classifies Gemini %s even when no valid function-call part was returned", async (finishReason, kind) => {
    const response = {
      candidates: [{ index: 0, finishReason, content: { parts: [] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    };
    expectProviderOutputError(() => fromGeminiGenerateContentResponse(response), {
      kind,
      usage: expect.objectContaining({ inputTokens: 2, outputTokens: 1 }),
    });

    const { error, events } = await collectModelStreamError(geminiModelWithStreams([[response]]));
    expect(events).toEqual([]);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind,
      usage: expect.objectContaining({ inputTokens: 2, outputTokens: 1 }),
    });
  });

  it("maps blocked prompt feedback to an explicit content-filter finish", async () => {
    const blocked = {
      candidates: [],
      promptFeedback: { blockReason: "SAFETY" },
      usageMetadata: { promptTokenCount: 2 },
    };

    expect(fromGeminiGenerateContentResponse(blocked)).toMatchObject({
      choice: [],
      finishReason: "content-filter",
      providerFinishReason: "SAFETY",
    });

    const model = geminiModelWithStreams([[blocked]]);
    const events = await collect(
      model.streamCompletion({
        chatHistory: [Message.user("blocked")],
        documents: [],
        tools: [],
      }),
    );
    expect(finalResponseFrom(events)).toMatchObject({
      choice: [],
      finishReason: "content-filter",
      providerFinishReason: "SAFETY",
    });
  });

  it("rejects malformed Gemini candidate part containers and entries", () => {
    for (const parts of [{ invalid: true }, [null]]) {
      expectProviderOutputError(
        () =>
          fromGeminiGenerateContentResponse({
            candidates: [{ index: 0, finishReason: "STOP", content: { parts } }],
            usageMetadata: { promptTokenCount: 2 },
          }),
        {
          kind: "invalid-tool-call",
          usage: expect.objectContaining({ inputTokens: 2 }),
        },
      );
    }
  });

  it.each([
    ["partialArgs", []],
    ["willContinue", false],
  ])("rejects unsupported Gemini %s tool-call fragments", (field, value) => {
    expectProviderOutputError(
      () =>
        fromGeminiGenerateContentResponse({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    functionCall: {
                      id: "call-partial",
                      name: "lookup",
                      args: {},
                      [field]: value,
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {},
        }),
      { kind: "incomplete-tool-call", toolCallId: "call-partial" },
    );
  });

  it("rejects an unsafe terminal reason after streamed tool progress", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [{ functionCall: { name: "lookup", args: { id: "A1" } } }],
              },
            },
          ],
        },
        {
          candidates: [{ index: 0, finishReason: "MAX_TOKENS", content: { parts: [] } }],
          usageMetadata: {},
        },
      ],
    ]);

    const { error, events } = await collectModelStreamError(model);
    expect(events.filter((event) => event.type === "tool_call_delta")).toHaveLength(2);
    expect(error).toBeInstanceOf(CompletionProviderOutputError);
    expect(error).toMatchObject({ kind: "truncated-tool-call", finishReason: "length" });
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it("gives an unsafe same-chunk finish reason precedence over malformed tool arguments", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [
            {
              index: 0,
              finishReason: "MAX_TOKENS",
              content: {
                parts: [
                  {
                    functionCall: { id: "call-1", name: "lookup", args: Number.POSITIVE_INFINITY },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
        },
      ],
    ]);

    const { error, events } = await collectModelStreamError(model);
    expect(events.some((event) => event.type === "tool_call_delta")).toBe(false);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "truncated-tool-call",
      finishReason: "length",
      usage: expect.objectContaining({ inputTokens: 2, outputTokens: 3 }),
    });
  });

  it("rejects tool progress after a terminal chunk", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [{ index: 0, finishReason: "STOP", content: { parts: [{ text: "done" }] } }],
          usageMetadata: {},
        },
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [{ functionCall: { id: "call-late", name: "lookup", args: {} } }],
              },
            },
          ],
        },
      ],
    ]);

    const { error, events } = await collectModelStreamError(model);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
    });
    expect(events.some((event) => event.type === "tool_call_delta")).toBe(false);
  });

  it("rejects synthesized no-id tool-call collisions across chunks", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [
            {
              index: 0,
              content: { parts: [{ functionCall: { name: "lookup", args: { id: "A1" } } }] },
            },
          ],
        },
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [
                  { text: "shifted" },
                  { functionCall: { name: "lookup", args: { id: "A2" } } },
                ],
              },
            },
          ],
        },
      ],
    ]);

    const { error, events } = await collectModelStreamError(model);
    expect(error).toMatchObject({
      name: "CompletionProviderOutputError",
      kind: "invalid-tool-call",
      toolCallId: "gemini-tool-1",
    });
    expect(events.filter((event) => event.type === "tool_call_delta")).toHaveLength(2);
  });

  it("accepts repeated explicit tool-call snapshots with equivalent object key order", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [
                  {
                    functionCall: {
                      id: "call-1",
                      name: "lookup",
                      args: { first: 1, second: 2 },
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [
                  {
                    functionCall: {
                      id: "call-1",
                      name: "lookup",
                      args: { second: 2, first: 1 },
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [{ index: 0, finishReason: "STOP", content: { parts: [] } }],
          usageMetadata: {},
        },
      ],
    ]);

    const events = await collect(
      model.streamCompletion({
        chatHistory: [Message.user("lookup")],
        documents: [],
        tools: [],
      }),
    );

    expect(finalResponseFrom(events).choice).toEqual([
      AssistantContent.toolCall("call-1", "lookup", { first: 1, second: 2 }, "call-1"),
    ]);
  });

  it("rejects a stream that ends after unterminated tool progress", async () => {
    const model = geminiModelWithStreams([
      [
        {
          candidates: [
            {
              index: 0,
              content: {
                parts: [{ functionCall: { name: "lookup", args: { id: "A1" } } }],
              },
            },
          ],
        },
      ],
    ]);

    const { error, events } = await collectModelStreamError(model);
    expect(events.filter((event) => event.type === "tool_call_delta")).toHaveLength(2);
    expect(error).toBeInstanceOf(CompletionProviderOutputError);
    expect(error).toMatchObject({
      kind: "incomplete-tool-call",
      toolCallId: "gemini-tool-0",
    });
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it("executes an SDK tool call without an id exactly once", async () => {
    const toolExecutions: unknown[] = [];
    const model = geminiModelWithStreams([
      [
        sdkResponse({
          candidates: [
            {
              index: 0,
              finishReason: "STOP",
              content: {
                parts: [{ functionCall: { name: "record", args: { value: 1 } } }],
              },
            },
          ],
          usageMetadata: {},
        }),
      ],
      [
        sdkResponse({
          candidates: [
            {
              index: 0,
              finishReason: "STOP",
              content: { parts: [{ text: "done" }] },
            },
          ],
          usageMetadata: {},
        }),
      ],
    ]);
    const agent = new Agent({
      id: "gemini-no-id-tool",
      model,
      tools: [recordingTool("record", toolExecutions)],
    });

    const events = await collect(agent.stream({ prompt: "record once" }));

    expect(toolExecutions).toEqual([{ value: 1 }]);
    expect(events.flatMap((event) => (event.type === "tool_call" ? [event.toolCall] : []))).toEqual(
      [AssistantContent.toolCall("gemini-tool-0", "record", { value: 1 })],
    );
  });

  it("maps Gemini thought summaries and thought signatures", () => {
    expect(
      fromGeminiGenerateContentResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "Reviewing.", thought: true },
                { text: "Answer.", thoughtSignature: "text_sig" },
                {
                  functionCall: { id: "call-1", name: "lookup", args: { query: "x" } },
                  thoughtSignature: "tool_sig",
                },
              ],
            },
          },
        ],
        usageMetadata: {},
      }).choice,
    ).toEqual([
      AssistantContent.reasoningSummary("Reviewing."),
      { ...AssistantContent.text("Answer."), signature: "text_sig" },
      {
        ...AssistantContent.toolCall("call-1", "lookup", { query: "x" }, "call-1"),
        signature: "tool_sig",
      },
    ]);

    expect(
      fromGeminiGenerateContentStreamChunk({
        candidates: [{ content: { parts: [{ text: "Reviewing.", thought: true }] } }],
      }),
    ).toEqual([{ type: "reasoning_delta", delta: "Reviewing.", contentType: "summary" }]);
  });

  it("uses the SDK client for completion and streaming", async () => {
    const calls: unknown[] = [];
    const client = new GeminiClient({
      client: {
        models: {
          generateContent: async (params: unknown) => {
            calls.push(params);
            return { text: "ok", usageMetadata: {} };
          },
          generateContentStream: async function* (params: unknown) {
            calls.push(params);
            yield { text: "o" };
            yield { text: "k", usageMetadata: {} };
          },
        },
      } as never,
    });

    const model = client.completionModel({ modelId: "gemini-test" });
    expect(model).toBeInstanceOf(GeminiCompletionModel);

    await expect(
      model.completion({ chatHistory: [Message.user("hello")], documents: [], tools: [] }),
    ).resolves.toMatchObject({ choice: [AssistantContent.text("ok")] });

    const events = [];
    for await (const event of model.streamCompletion({
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    })) {
      events.push(event);
    }

    expect(calls).toHaveLength(2);
    expect(calls).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({
          httpOptions: { retryOptions: { attempts: 1 } },
        }),
      }),
      expect.objectContaining({
        config: expect.objectContaining({
          httpOptions: { retryOptions: { attempts: 1 } },
        }),
      }),
    ]);
    expect(events).toContainEqual({ type: "text_delta", delta: "o" });
    expect(events).toContainEqual({ type: "text_delta", delta: "k" });
  });
});

function sdkResponse(values: Record<string, unknown>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), values);
}

function finalResponseFrom(events: CompletionModelStreamEvent[]) {
  const final = events.find(
    (event): event is Extract<CompletionModelStreamEvent, { type: "final" }> =>
      event.type === "final",
  );
  if (final === undefined) {
    throw new Error("Expected a final Gemini stream event.");
  }
  return final.response;
}

function expectProviderOutputError(run: () => unknown, expected: Record<string, unknown>): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CompletionProviderOutputError);
  expect(thrown).toMatchObject(expected);
}

function geminiModelWithStreams(streams: unknown[][]): GeminiCompletionModel {
  return new GeminiCompletionModel(
    {
      models: {
        generateContentStream: async () => streamFrom(streams.shift() ?? []),
      },
    } as never,
    "gemini-test",
  );
}

async function collectModelStreamError(model: GeminiCompletionModel): Promise<{
  error: unknown;
  events: CompletionModelStreamEvent[];
}> {
  const events: CompletionModelStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const event of model.streamCompletion({
      chatHistory: [Message.user("run a tool")],
      documents: [],
      tools: [],
    })) {
      events.push(event);
    }
  } catch (value) {
    error = value;
  }
  return { error, events };
}

function recordingTool(name: string, calls: unknown[]): Tool {
  return {
    name,
    definition() {
      return { name, description: `Record ${name} calls`, parameters: { type: "object" } };
    },
    call(args) {
      calls.push(args);
      return "ok";
    },
  };
}

async function* streamFrom(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) {
    yield event;
  }
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}
