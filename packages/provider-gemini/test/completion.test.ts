import {
  AssistantContent,
  type CompletionRequest,
  Message,
  ToolContent,
  UserContent,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  fromGeminiGenerateContentResponse,
  fromGeminiGenerateContentStreamChunk,
  messagesToGeminiContents,
  toGeminiGenerateContentParams,
} from "../src/gemini/completion";
import { GeminiClient, GeminiCompletionModel } from "../src/index";

describe("Gemini completion mapping", () => {
  it("exposes Gemini capability metadata", () => {
    const model = new GeminiCompletionModel({} as never, "gemini-test");

    expect(model.provider).toBe("gemini");
    expect(model.defaultModel).toBe("gemini-test");
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
        Message.tool(ToolContent.toolResult("call_1", "shipped")),
      ],
      documents: [{ id: "policy", text: "Refunds take 5 days." }],
      tools: [
        { name: "lookup_order", description: "Look up an order.", parameters: { type: "object" } },
      ],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: { type: "function", name: "lookup_order" },
      outputSchema: { type: "object", title: "OrderAnswer" },
      additionalParams: {
        labels: { surface: "test" },
        config: {
          topP: 0.9,
          temperature: 0.4,
        },
      },
    };

    expect(toGeminiGenerateContentParams("gemini-2.5-flash", request)).toEqual({
      model: "gemini-2.5-flash",
      labels: { surface: "test" },
      config: {
        systemInstruction: "Use the support policy.\n\nSystem context.",
        temperature: 0.4,
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

  it("preserves Gemini thought signatures in assistant history", () => {
    const toolCall = AssistantContent.toolCall("call_1", "lookup_order", { id: "A1" });
    toolCall.signature = "tool_sig";
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
        totalTokenCount: 7,
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
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      cachedInputTokens: 1,
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

  it("maps Gemini thought summaries and thought signatures", () => {
    expect(
      fromGeminiGenerateContentResponse({
        candidates: [
          {
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

    const model = client.completionModel("gemini-test");
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
    expect(events).toContainEqual({ type: "text_delta", delta: "o" });
    expect(events).toContainEqual({ type: "text_delta", delta: "k" });
  });
});
