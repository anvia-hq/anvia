import { AssistantContent, type CompletionRequest, Message, Usage, UserContent } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { OpenAIResponsesCompletionModel } from "../src/index";
import {
  fromOpenAIResponse,
  fromOpenAIStreamEvent,
  openaiMessageHelpers,
  toOpenAIResponsesParams,
} from "../src/openai/responses";

describe("OpenAI Responses mapping", () => {
  it("exposes Responses capability metadata", () => {
    const model = new OpenAIResponsesCompletionModel({} as never, "gpt-test");

    expect(model.provider).toBe("openai");
    expect(model.defaultModel).toBe("gpt-test");
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

  it("maps internal tools and tool outputs to Responses API params", () => {
    const request: CompletionRequest = {
      chatHistory: [
        Message.user("What is 2+5?"),
        Message.assistant([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
        Message.tool([
          {
            type: "tool_result",
            id: "call_1",
            callId: "fc_1",
            content: [{ type: "text", text: "7" }],
          },
        ]),
      ],
      documents: [],
      tools: [
        {
          name: "add",
          description: "Add numbers",
          parameters: { type: "object" },
        },
      ],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "auto",
    };

    const params = toOpenAIResponsesParams("gpt-5", request);

    expect(params.model).toBe("gpt-5");
    expect(params.tools).toEqual([
      {
        type: "function",
        name: "add",
        description: "Add numbers",
        parameters: { type: "object" },
      },
    ]);
    expect(params.input).toContainEqual({
      type: "function_call_output",
      call_id: "fc_1",
      output: "7",
    });
  });

  it("prepends normalized static context before chat history", () => {
    const request: CompletionRequest = {
      chatHistory: [Message.system("Use context."), Message.user("What is the owner?")],
      documents: [{ id: "owner", text: "Mira owns launch checklists." }],
      tools: [],
    };

    const params = toOpenAIResponsesParams("gpt-5", request);

    expect(params.input).toEqual([
      { role: "system", content: "Use context." },
      { role: "user", content: "<file id: owner>\nMira owns launch checklists.\n</file>\n" },
      { role: "user", content: "What is the owner?" },
    ]);
  });

  it("maps image and document attachments to Responses input parts", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        Message.user([
          UserContent.text("Inspect these."),
          UserContent.imageUrl("https://example.com/image.png", { detail: "auto" }),
          UserContent.imageBase64("abc123", "image/png"),
          UserContent.documentUrl("https://example.com/report.pdf", "application/pdf"),
          UserContent.documentBase64("pdf123", "application/pdf", { filename: "report.pdf" }),
          UserContent.documentText("Plain document text."),
        ]),
      ),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Inspect these." },
          { type: "input_image", image_url: "https://example.com/image.png", detail: "auto" },
          { type: "input_image", image_url: "data:image/png;base64,abc123" },
          { type: "input_file", file_url: "https://example.com/report.pdf" },
          {
            type: "input_file",
            file_data: "data:application/pdf;base64,pdf123",
            filename: "report.pdf",
          },
          { type: "input_text", text: "Plain document text." },
        ],
      },
    ]);
  });

  it("rejects unsupported OpenAI attachment history", () => {
    expect(() =>
      openaiMessageHelpers.messageToResponsesInput(
        Message.user([UserContent.documentBase64("abc123", "text/csv")]),
      ),
    ).toThrow("OpenAI Responses only supports PDF document attachments");

    expect(() =>
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([AssistantContent.imageBase64("abc123", "image/png")]),
      ),
    ).toThrow("OpenAI Responses does not support image content in assistant history");
  });

  it("maps Responses function calls back to internal tool calls", () => {
    const response = fromOpenAIResponse({
      id: "resp_1",
      output: [
        {
          type: "function_call",
          id: "item_1",
          call_id: "fc_1",
          name: "add",
          arguments: '{"x":2,"y":5}',
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: {
          cached_tokens: 3,
        },
      },
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("item_1", "add", { x: 2, y: 5 }, "fc_1"),
    ]);
    expect(response.usage).toEqual({
      ...Usage.empty(),
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 3,
    });
    expect(response.messageId).toBe("resp_1");
  });

  it("maps Responses reasoning content and summaries", () => {
    const response = fromOpenAIResponse({
      output: [
        {
          type: "reasoning",
          id: "rs_1",
          content: [{ type: "reasoning_text", text: "Visible reasoning." }],
          summary: [{ type: "summary_text", text: "Short summary." }],
          encrypted_content: "encrypted",
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      {
        type: "reasoning",
        id: "rs_1",
        text: "Visible reasoning.Short summary.",
        content: [
          { type: "text", text: "Visible reasoning." },
          { type: "summary", text: "Short summary." },
          { type: "encrypted", data: "encrypted" },
        ],
      },
    ]);
  });

  it("exposes helper conversion for assistant function call history", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([AssistantContent.toolCall("call_1", "lookup", { query: "x" }, "fc_1")]),
      ),
    ).toEqual([
      {
        type: "function_call",
        id: "call_1",
        call_id: "fc_1",
        name: "lookup",
        arguments: '{"query":"x"}',
      },
    ]);
  });

  it("preserves assistant reasoning items before dependent function calls", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([
          AssistantContent.reasoning("", "rs_1"),
          AssistantContent.toolCall("fc_1", "search", { query: "x" }, "call_1"),
        ]),
      ),
    ).toEqual([
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "search",
        arguments: '{"query":"x"}',
      },
    ]);
  });

  it("preserves structured assistant reasoning history", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([
          AssistantContent.reasoningFromContent(
            [
              { type: "text", text: "Visible reasoning." },
              { type: "summary", text: "Short summary." },
              { type: "encrypted", data: "encrypted" },
            ],
            "rs_1",
          ),
        ]),
      ),
    ).toEqual([
      {
        type: "reasoning",
        id: "rs_1",
        summary: [{ type: "summary_text", text: "Short summary." }],
        content: [{ type: "reasoning_text", text: "Visible reasoning." }],
        encrypted_content: "encrypted",
      },
    ]);
  });

  it("maps Responses stream events to internal stream events", () => {
    expect(fromOpenAIStreamEvent({ type: "response.output_text.delta", delta: "hi" })).toEqual({
      type: "text_delta",
      delta: "hi",
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.reasoning_summary_text.delta",
        item_id: "rs_1",
        delta: "Checked.",
      }),
    ).toEqual({
      type: "reasoning_delta",
      id: "rs_1",
      delta: "Checked.",
      contentType: "summary",
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "call_1",
          call_id: "fc_1",
          name: "lookup",
          arguments: '{"query":"x"}',
        },
      }),
    ).toEqual({
      type: "tool_call",
      toolCall: AssistantContent.toolCall("call_1", "lookup", { query: "x" }, "fc_1"),
    });
  });
});
