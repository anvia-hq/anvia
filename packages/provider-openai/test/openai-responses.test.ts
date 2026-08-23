import { Agent, type Tool } from "@anvia/core";
import {
  COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  Usage,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import { OpenAIClient } from "../src/index";
import {
  fromOpenAIResponse,
  fromOpenAIStreamEvent,
  OpenAIResponsesCompletionModel,
  openaiMessageHelpers,
  toOpenAIResponsesParams,
} from "../src/openai/responses";

describe("OpenAI Responses mapping", () => {
  it("exposes Responses capability metadata", () => {
    const model = new OpenAIResponsesCompletionModel({} as never, "gpt-test");

    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-test");
    expect(model.capabilities).toEqual({
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: true,
      providerTools: true,
    });
  });

  it("resolves built-in, custom, and unknown model context limits", () => {
    const client = new OpenAIClient({ client: {} as never });
    const builtIn = client.completionModel({ modelId: "gpt-5.6", api: "responses" });
    const custom = client.completionModel({
      modelId: "custom",
      api: "responses",
      contextLimits: { contextWindow: 42_000, maxOutputTokens: 2_000 },
    });
    const unknown = client.completionModel({ modelId: "unknown", api: "responses" });

    expect(builtIn.contextLimits).toMatchObject({
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
    });
    expect(custom.contextLimits).toEqual({ contextWindow: 42_000, maxOutputTokens: 2_000 });
    expect(unknown.contextLimits).toBeUndefined();
  });

  it("maps incomplete max-output responses to the normalized length reason", () => {
    const response = fromOpenAIResponse({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"answer":"partial' }],
        },
      ],
      usage: {},
    });

    expect(response).toMatchObject({
      finishReason: "length",
      providerFinishReason: "max_output_tokens",
    });
  });

  it("attaches context usage to completed and streamed responses", async () => {
    const rawResponse = {
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 60, output_tokens: 15, total_tokens: 75 },
    };
    const request: CompletionRequest = {
      chatHistory: [Message.user("hello")],
      documents: [],
      tools: [],
    };
    const completionModel = new OpenAIResponsesCompletionModel(
      { responses: { create: async () => rawResponse } } as never,
      "gpt-5",
      { contextWindow: 400_000, maxOutputTokens: 128_000 },
    );

    const response = await completionModel.completion(request);

    expect(response.contextUsage).toMatchObject({
      usedTokens: 60,
      remainingTokens: 399_940,
      model: { modelId: "gpt-5", context: { contextWindow: 400_000 } },
    });

    const streamModel = new OpenAIResponsesCompletionModel(
      {
        responses: {
          create: async () => ({
            async *[Symbol.asyncIterator]() {
              yield { type: "response.completed", response: rawResponse };
            },
          }),
        },
      } as never,
      "gpt-5",
      { contextWindow: 400_000, maxOutputTokens: 128_000 },
    );
    const events: CompletionModelStreamEvent[] = [];
    for await (const event of streamModel.streamCompletion(request)) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "final",
      response: { contextUsage: { usedTokens: 60, remainingTokens: 399_940 } },
    });
  });

  it("uses canonical local and provider tools instead of providerOptions.tools", () => {
    const params = toOpenAIResponsesParams("gpt-5", {
      chatHistory: [Message.user("research")],
      documents: [],
      tools: [{ name: "local", description: "Local", parameters: { type: "object" } }],
      providerTools: [
        {
          kind: "provider",
          provider: "openai",
          name: "web_search",
          configuration: { filters: { allowed_domains: ["example.com"] } },
        },
      ],
      providerOptions: {
        tools: [{ type: "code_interpreter" }],
      },
    });

    expect(params.tools).toEqual([
      {
        type: "function",
        name: "local",
        description: "Local",
        parameters: { type: "object" },
      },
      { type: "web_search", filters: { allowed_domains: ["example.com"] } },
    ]);
  });

  it("ignores providerOptions.tools when canonical tools are empty", () => {
    expect(
      toOpenAIResponsesParams("gpt-5", {
        chatHistory: [Message.user("research")],
        documents: [],
        tools: [],
        providerOptions: { tools: "web_search" },
      }).tools,
    ).toBeUndefined();
  });

  it("maps internal tools and tool outputs to Responses API params", () => {
    const request: CompletionRequest = {
      chatHistory: [
        Message.user("What is 2+5?", { metadata: { composer: { entities: [] } } }),
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
    expect(params.input).toContainEqual({ role: "user", content: "What is 2+5?" });
  });

  it("maps multimodal tool outputs to Responses API output content", () => {
    const params = toOpenAIResponsesParams("gpt-5", {
      chatHistory: [
        Message.assistant([AssistantContent.toolCall("call_1", "computer_screenshot", {}, "fc_1")]),
        Message.tool(
          ToolContent.toolResult(
            "call_1",
            [
              { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
              {
                type: "file",
                data: { type: "data", data: "base64-png" },
                mediaType: "image/png",
              },
            ],
            "fc_1",
          ),
        ),
      ],
      documents: [],
      tools: [],
    });

    expect(params.input).toContainEqual({
      type: "function_call_output",
      call_id: "fc_1",
      output: [
        { type: "input_text", text: '{"coordMap":"0,0,100,100,100,100"}' },
        {
          type: "input_image",
          image_url: "data:image/png;base64,base64-png",
          detail: "auto",
        },
      ],
    });
  });

  it("summarizes provider request metadata for traces", () => {
    const model = new OpenAIResponsesCompletionModel({} as never, "gpt-test");
    const request: CompletionRequest = {
      instructions: "Be concise.",
      chatHistory: [Message.user("What is 2+5?")],
      documents: [],
      tools: [{ name: "add", description: "Add numbers", parameters: { type: "object" } }],
      temperature: 0.2,
      maxTokens: 128,
      toolChoice: "auto",
    };

    expect(model.traceRequest(request, { stream: true })).toMatchObject({
      provider: "openai",
      api: "responses",
      stream: true,
      model: "gpt-test",
      inputCount: 1,
      toolCount: 1,
      toolNames: ["add"],
      parameterKeys: expect.arrayContaining(["input", "model", "stream", "tools"]),
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
    ).toThrow("OpenAI Responses only supports image and PDF file attachments");

    expect(() =>
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([AssistantContent.imageBase64("abc123", "image/png")]),
      ),
    ).toThrow("OpenAI Responses does not support image or file content in assistant history");
  });

  it("maps Responses function calls back to internal tool calls", () => {
    const response = fromOpenAIResponse({
      id: "resp_1",
      status: "completed",
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
      details: {
        input: 7,
        input_cached_tokens: 3,
        output: 5,
        output_reasoning_tokens: 0,
        total: 15,
      },
    });
    expect(response.messageId).toBe("resp_1");
  });

  it("maps citations and provider-executed tool calls", () => {
    const response = fromOpenAIResponse({
      citations: ["https://x.ai/news"],
      output: [
        {
          type: "web_search_call",
          id: "search_1",
          status: "completed",
          action: { type: "search", query: "xAI news" },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "News [[1]](https://x.ai/news)",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://x.ai/news",
                  title: "1",
                  start_index: 5,
                  end_index: 31,
                },
              ],
            },
          ],
        },
      ],
      usage: {},
    });

    expect(response.sources).toEqual([
      {
        type: "url",
        url: "https://x.ai/news",
        title: "1",
        startIndex: 5,
        endIndex: 31,
      },
    ]);
    expect(response.providerToolCalls).toEqual([
      {
        id: "search_1",
        name: "web_search",
        status: "completed",
        details: { action: { type: "search", query: "xAI news" } },
      },
    ]);
  });

  it("rejects malformed non-streaming Responses tool arguments", () => {
    expect(
      thrownBy(() =>
        fromOpenAIResponse({
          status: "completed",
          output: [
            {
              type: "function_call",
              id: "tool_0",
              call_id: "call_abc",
              name: "ExecCommand",
              arguments: '{"command":"pwd"',
            },
          ],
          usage: {
            input_tokens: 7,
            output_tokens: 2,
            input_tokens_details: { cached_tokens: 3 },
          },
        }),
      ),
    ).toMatchObject(
      providerOutputError("malformed-tool-arguments", {
        toolCallId: "tool_0",
        usage: {
          inputTokens: 7,
          outputTokens: 2,
          totalTokens: 9,
          cachedInputTokens: 3,
        },
      }),
    );
  });

  it("retries malformed Responses tool-call arguments without executing the tool", async () => {
    const completionRequests: unknown[] = [];
    const toolExecutions: unknown[] = [];
    const client = new OpenAIClient({
      client: {
        responses: {
          create: async (request: unknown) => {
            completionRequests.push(request);
            return {
              id: "resp_malformed_tool",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "tool_0",
                  call_id: "call_abc",
                  name: "test_tool",
                  arguments: '{"query":',
                },
              ],
              usage: {},
            };
          },
        },
      } as never,
    });
    const agent = new Agent({
      id: "malformed-responses-tool-retry",
      model: client.completionModel({ modelId: "responses-test", api: "responses" }),
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const error = await agent
      .generate({
        prompt: "Call test_tool.",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject(
      providerOutputError("malformed-tool-arguments", { toolCallId: "tool_0" }),
    );
    expect(completionRequests).toHaveLength(3);
    expect(toolExecutions).toHaveLength(0);
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["missing", undefined],
  ])("rejects and retries a valid Responses tool call with a %s status without executing it", async (_label, status) => {
    const completionRequests: unknown[] = [];
    const toolExecutions: unknown[] = [];
    const client = new OpenAIClient({
      client: {
        responses: {
          create: async (request: unknown) => {
            completionRequests.push(request);
            return {
              id: "resp_unsafe_status",
              status,
              output: [
                {
                  type: "function_call",
                  id: "tool_0",
                  call_id: "call_abc",
                  name: "test_tool",
                  arguments: '{"query":"safe"}',
                },
              ],
              usage: { input_tokens: 2, output_tokens: 1 },
            };
          },
        },
      } as never,
    });
    const agent = new Agent({
      id: `unsafe-responses-status-${status ?? "missing"}`,
      model: client.completionModel({ modelId: "responses-test", api: "responses" }),
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const error = await agent
      .generate({
        prompt: "Call test_tool.",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject(
      providerOutputError("invalid-tool-call", {
        finishReason: "other",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      }),
    );
    expect(completionRequests).toHaveLength(3);
    expect(toolExecutions).toHaveLength(0);
  });

  it.each([
    "failed",
    "cancelled",
    "queued",
    "in_progress",
  ])("rejects a %s Responses status without treating an empty response as success", (status) => {
    expect(
      thrownBy(() =>
        fromOpenAIResponse({
          id: "resp_invalid_status",
          status,
          output: [],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      ),
    ).toMatchObject(
      providerOutputError("invalid-response", {
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      }),
    );
  });

  it("uses the Responses call id when a non-streaming function call omits its item id", () => {
    expect(
      fromOpenAIResponse({
        status: "completed",
        output: [
          {
            type: "function_call",
            status: "completed",
            call_id: "call_abc",
            name: "lookup",
            arguments: "{}",
          },
        ],
        usage: {},
      }).choice,
    ).toEqual([AssistantContent.toolCall("call_abc", "lookup", {}, "call_abc")]);
  });

  it.each([
    ["missing", undefined, "incomplete-tool-call"],
    ["non-string", { query: "x" }, "invalid-tool-arguments"],
    ["non-finite", "1e400", "invalid-tool-arguments"],
  ])("rejects %s terminal Responses tool arguments", (_label, argumentsValue, kind) => {
    const error = thrownBy(() =>
      fromOpenAIResponse({
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "tool_0",
            call_id: "call_abc",
            name: "Echo",
            arguments: argumentsValue,
          },
        ],
        usage: {},
      }),
    );

    expect(error).toMatchObject(providerOutputError(kind, { toolCallId: "tool_0" }));
  });

  it.each([
    "in_progress",
    "incomplete",
  ])("rejects a terminal Responses tool item whose status is %s", (status) => {
    expect(
      thrownBy(() =>
        fromOpenAIResponse({
          status: "completed",
          output: [
            {
              type: "function_call",
              id: "tool_0",
              call_id: "call_abc",
              name: "Echo",
              arguments: "{}",
              status,
            },
          ],
          usage: {},
        }),
      ),
    ).toMatchObject(providerOutputError("incomplete-tool-call", { toolCallId: "tool_0" }));
  });

  it("rejects an incomplete Responses output_item.done tool call", () => {
    expect(
      thrownBy(() =>
        fromOpenAIStreamEvent({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "tool_0",
            call_id: "call_abc",
            name: "Echo",
            arguments: "{}",
            status: "incomplete",
          },
        }),
      ),
    ).toMatchObject(providerOutputError("incomplete-tool-call", { toolCallId: "tool_0" }));
  });

  it("accepts an in-progress Responses item when its completed item is terminal", () => {
    expect(
      fromOpenAIStreamEvent({
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "Echo",
          arguments: "",
          status: "in_progress",
        },
      }),
    ).toMatchObject({ type: "tool_call_delta", id: "tool_0" });
    expect(
      fromOpenAIStreamEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "Echo",
          arguments: "{}",
          status: "completed",
        },
      }),
    ).toMatchObject({ type: "tool_call", toolCall: { toolCallId: "tool_0", input: {} } });
  });

  it.each([
    ["max_output_tokens", "truncated-tool-call", 3],
    ["content_filter", "filtered-tool-call", 1],
  ])("does not execute a valid Responses tool call ending with %s", async (incompleteReason, kind, expectedRequests) => {
    const completionRequests: unknown[] = [];
    const toolExecutions: unknown[] = [];
    const client = new OpenAIClient({
      client: {
        responses: {
          create: async (request: unknown) => {
            completionRequests.push(request);
            return {
              id: "resp_unsafe_tool",
              status: "incomplete",
              incomplete_details: { reason: incompleteReason },
              output: [
                {
                  type: "function_call",
                  id: "tool_0",
                  call_id: "call_abc",
                  name: "test_tool",
                  arguments: '{"query":"safe"}',
                },
              ],
              usage: { input_tokens: 2, output_tokens: 1 },
            };
          },
        },
      } as never,
    });
    const agent = new Agent({
      id: `unsafe-responses-finish-${incompleteReason}`,
      model: client.completionModel({ modelId: "responses-test", api: "responses" }),
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const error = await agent
      .generate({
        prompt: "Call test_tool.",
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      })
      .catch((value: unknown) => value);

    expect(error).toMatchObject(providerOutputError(kind));
    expect(completionRequests).toHaveLength(expectedRequests);
    expect(toolExecutions).toHaveLength(0);
  });

  it("maps scalar non-streaming Responses tool arguments", () => {
    const response = fromOpenAIResponse({
      status: "completed",
      output: [
        {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "Echo",
          arguments: '"hello"',
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([
      AssistantContent.toolCall("tool_0", "Echo", "hello", "call_abc"),
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t"],
  ])("rejects %s non-streaming Responses tool arguments", (_label, argumentsText) => {
    expect(() =>
      fromOpenAIResponse({
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "tool_0",
            call_id: "call_abc",
            name: "Echo",
            arguments: argumentsText,
          },
        ],
        usage: {},
      }),
    ).toThrowError(expect.objectContaining({ kind: "malformed-tool-arguments" }));
  });

  it("maps Responses refusals to visible assistant text", () => {
    const response = fromOpenAIResponse({
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "I can't comply with that." }],
        },
      ],
      usage: {},
    });

    expect(response.choice).toEqual([AssistantContent.text("I can't comply with that.")]);
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
        details: [
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

  it("serializes valid scalar tool arguments in Responses assistant history as JSON", () => {
    expect(
      openaiMessageHelpers.messageToResponsesInput(
        Message.assistant([AssistantContent.toolCall("tool_0", "Echo", "hello", "call_abc")]),
      ),
    ).toEqual([
      {
        type: "function_call",
        id: "tool_0",
        call_id: "call_abc",
        name: "Echo",
        arguments: '"hello"',
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
        type: "response.function_call_arguments.delta",
        item_id: "tool_1",
        delta: '{"query":',
      }),
    ).toEqual({
      type: "tool_call_delta",
      id: "tool_1",
      argumentsDelta: '{"query":',
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.function_call_arguments.done",
        item_id: "tool_1",
        name: "lookup",
        arguments: '{"query":"x"}',
      }),
    ).toEqual({
      type: "tool_call_delta",
      id: "tool_1",
      name: "lookup",
      argumentsDelta: '{"query":"x"}',
      argumentsMode: "replace",
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

    expect(
      fromOpenAIStreamEvent({
        type: "response.output_text.annotation.added",
        annotation: {
          type: "url_citation",
          url: "https://x.ai/news",
          title: "1",
          start_index: 5,
          end_index: 31,
        },
      }),
    ).toEqual({
      type: "source",
      source: {
        type: "url",
        url: "https://x.ai/news",
        title: "1",
        startIndex: 5,
        endIndex: 31,
      },
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.output_item.done",
        item: {
          type: "web_search_call",
          id: "search_1",
          status: "completed",
          action: { type: "search", query: "xAI news" },
        },
      }),
    ).toEqual({
      type: "provider_tool_call",
      toolCall: {
        id: "search_1",
        name: "web_search",
        status: "completed",
        details: { action: { type: "search", query: "xAI news" } },
      },
    });
  });

  it("rejects malformed arguments in completed Responses stream items", () => {
    expect(
      thrownBy(() =>
        fromOpenAIStreamEvent({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "tool_0",
            call_id: "call_abc",
            name: "ExecCommand",
            arguments: '{"command":"pwd"',
          },
        }),
      ),
    ).toMatchObject(providerOutputError("malformed-tool-arguments", { toolCallId: "tool_0" }));
  });

  it.each([
    ["max_output_tokens", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
  ])("prioritizes an unsafe %s Responses stream finish over malformed arguments", async (incompleteReason, kind, finishReason) => {
    const malformedToolCall = {
      type: "function_call",
      id: "tool_0",
      call_id: "call_abc",
      name: "lookup",
      arguments: '{"query":',
    };
    const model = openAIResponsesModelWithStream([
      {
        type: "response.output_item.added",
        item: { ...malformedToolCall, arguments: "" },
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "tool_0",
        name: "lookup",
        arguments: malformedToolCall.arguments,
      },
      {
        type: "response.incomplete",
        response: {
          id: "resp_incomplete_tool",
          status: "incomplete",
          incomplete_details: { reason: incompleteReason },
          output: [malformedToolCall],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      },
    ]);

    await expect(collectResponsesStream(model)).rejects.toMatchObject(
      providerOutputError(kind, {
        finishReason,
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      }),
    );
  });

  it.each([
    ["max_output_tokens", "truncated-tool-call", "length"],
    ["content_filter", "filtered-tool-call", "content-filter"],
  ])("preserves an unsafe %s finish when the terminal Responses snapshot omits the streamed tool call", async (incompleteReason, kind, finishReason) => {
    const model = openAIResponsesModelWithStream([
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "lookup",
          arguments: "",
        },
      },
      {
        type: "response.incomplete",
        response: {
          id: "resp_incomplete_without_snapshot",
          status: "incomplete",
          incomplete_details: { reason: incompleteReason },
          output: [],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      },
    ]);

    await expect(collectResponsesStream(model)).rejects.toMatchObject(
      providerOutputError(kind, {
        finishReason,
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      }),
    );
  });

  it("uses the Responses call id when the optional item id is missing", () => {
    expect(
      fromOpenAIStreamEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          status: "completed",
          call_id: "call_abc",
          name: "lookup",
          arguments: "{}",
        },
      }),
    ).toEqual({
      type: "tool_call",
      toolCall: AssistantContent.toolCall("call_abc", "lookup", {}, "call_abc"),
    });
  });

  it("rejects duplicate and post-terminal Responses argument events", async () => {
    const added = {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        status: "in_progress",
        id: "tool_0",
        call_id: "call_abc",
        name: "lookup",
        arguments: "",
      },
    };
    const done = {
      type: "response.function_call_arguments.done",
      item_id: "tool_0",
      name: "lookup",
      arguments: '{"query":"anvia"}',
    };

    await expect(
      collectResponsesStream(openAIResponsesModelWithStream([added, done, done])),
    ).rejects.toMatchObject(providerOutputError("invalid-tool-call", { toolCallId: "tool_0" }));

    await expect(
      collectResponsesStream(
        openAIResponsesModelWithStream([
          added,
          done,
          {
            type: "response.function_call_arguments.delta",
            item_id: "tool_0",
            delta: " ",
          },
        ]),
      ),
    ).rejects.toMatchObject(providerOutputError("invalid-tool-call", { toolCallId: "tool_0" }));
  });

  it.each([
    ["call id", { id: "tool_0", name: "lookup", arguments: "{}" }],
    ["name", { id: "tool_0", call_id: "call_abc", arguments: "{}" }],
  ])("rejects a completed Responses stream tool call missing its %s", (_label, item) => {
    expect(
      thrownBy(() =>
        fromOpenAIStreamEvent({
          type: "response.output_item.done",
          item: { type: "function_call", ...item },
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call"));
  });

  it("rejects a completed Responses provider tool call missing its id", () => {
    expect(
      thrownBy(() =>
        fromOpenAIStreamEvent({
          type: "response.output_item.done",
          item: { type: "web_search_call", status: "completed" },
        }),
      ),
    ).toMatchObject(providerOutputError("invalid-tool-call"));
  });

  it("rejects inconsistent Responses stream tool ids and names", async () => {
    const idModel = openAIResponsesModelWithStream([
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "lookup",
          arguments: "",
        },
      },
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "tool_1",
          call_id: "call_abc",
          name: "lookup",
          arguments: "{}",
        },
      },
    ]);
    const nameModel = openAIResponsesModelWithStream([
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "tool_0",
          call_id: "call_abc",
          name: "lookup",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "tool_0",
        name: "search",
        arguments: "{}",
      },
    ]);

    await expect(collectResponsesStream(idModel)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call"),
    );
    await expect(collectResponsesStream(nameModel)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call", { toolCallId: "tool_0" }),
    );
  });

  it("requires a terminal Responses event after tool-call progress", async () => {
    const model = openAIResponsesModelWithStream([
      {
        type: "response.function_call_arguments.delta",
        item_id: "tool_0",
        delta: '{"query":',
      },
    ]);

    await expect(collectResponsesStream(model)).rejects.toMatchObject(
      providerOutputError("incomplete-tool-call", { toolCallId: "tool_0" }),
    );
  });

  it("stops consuming Responses events after completion so a trailing tool call cannot execute", async () => {
    const toolExecutions: unknown[] = [];
    let trailingEventRead = false;
    const model = new OpenAIResponsesCompletionModel(
      {
        responses: {
          create: async () => ({
            async *[Symbol.asyncIterator]() {
              yield {
                type: "response.completed",
                response: {
                  id: "resp_completed",
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "done" }],
                    },
                  ],
                  usage: {},
                },
              };
              trailingEventRead = true;
              yield {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  id: "tool_0",
                  call_id: "call_abc",
                  name: "test_tool",
                  arguments: '{"query":"unsafe"}',
                },
              };
            },
          }),
        },
      } as never,
      "responses-test",
    );
    const agent = new Agent({
      id: "responses-post-terminal-tool-call",
      model,
      tools: [recordingTool("test_tool", toolExecutions)],
    });

    const events = await collectAgentEvents(agent.stream({ prompt: "Finish without a tool." }));

    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(toolExecutions).toHaveLength(0);
    expect(trailingEventRead).toBe(false);
  });

  it("maps Responses terminal stream failure and incomplete events", () => {
    const errorEvent = {
      type: "error",
      code: "rate_limit_exceeded",
      message: "Too many requests.",
      param: null,
      sequence_number: 1,
    };

    expect(fromOpenAIStreamEvent(errorEvent)).toEqual({
      type: "error",
      error: errorEvent,
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.failed",
        response: {
          id: "resp_failed",
          error: { code: "server_error", message: "The response failed." },
        },
        sequence_number: 2,
      }),
    ).toEqual({
      type: "error",
      error: { code: "server_error", message: "The response failed." },
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.failed",
        response: {
          id: "resp_failed_with_usage",
          error: { code: "server_error", message: "The billed response failed." },
          usage: {
            input_tokens: 11,
            output_tokens: 4,
            total_tokens: 15,
            input_tokens_details: { cached_tokens: 2 },
          },
        },
        sequence_number: 3,
      }),
    ).toEqual({
      type: "error",
      error: { code: "server_error", message: "The billed response failed." },
      usage: {
        ...Usage.empty(),
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
        cachedInputTokens: 2,
        details: {
          input: 9,
          input_cached_tokens: 2,
          output: 4,
          output_reasoning_tokens: 0,
          total: 15,
        },
      },
    });

    expect(
      fromOpenAIStreamEvent({
        type: "response.incomplete",
        response: {
          id: "resp_incomplete",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "partial output" }],
            },
          ],
          usage: {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5,
          },
        },
        sequence_number: 4,
      }),
    ).toEqual({
      type: "final",
      response: {
        choice: [AssistantContent.text("partial output")],
        usage: {
          ...Usage.empty(),
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          details: {
            input: 2,
            input_cached_tokens: 0,
            output: 3,
            output_reasoning_tokens: 0,
            total: 5,
          },
        },
        rawResponse: expect.objectContaining({ id: "resp_incomplete" }),
        messageId: "resp_incomplete",
      },
    });
  });
});

function openAIResponsesModelWithStream(events: unknown[]): OpenAIResponsesCompletionModel {
  return new OpenAIResponsesCompletionModel(
    {
      responses: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
        }),
      },
    } as never,
    "responses-test",
  );
}

async function collectResponsesStream(
  model: OpenAIResponsesCompletionModel,
): Promise<CompletionModelStreamEvent[]> {
  const result: CompletionModelStreamEvent[] = [];
  for await (const event of model.streamCompletion({
    chatHistory: [Message.user("Call a tool.")],
    documents: [],
    tools: [],
  })) {
    result.push(event);
  }
  return result;
}

async function collectAgentEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
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

function thrownBy(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("Expected callback to throw.");
}

function providerOutputError(
  kind: string,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "CompletionProviderOutputError",
    code: COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
    kind,
    ...values,
  };
}
