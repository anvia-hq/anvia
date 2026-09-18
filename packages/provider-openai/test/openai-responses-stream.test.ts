import { Agent, type Tool } from "@anvia/core";
import {
  COMPLETION_PROVIDER_OUTPUT_ERROR_CODE,
  type CompletionModelStreamEvent,
} from "@anvia/core/completion";
import { describe, expect, it } from "vitest";
import { Message } from "../../core/test/helpers/imports";
import { OpenAIResponsesCompletionModel } from "../src/openai/responses";

describe("OpenAI Responses tool-call streaming compatibility", () => {
  it("accepts a standard arguments.done event that includes the function name", async () => {
    const events = await collectResponsesStream(
      openAIResponsesModelWithStream(weatherToolCallStream()),
    );

    expect(terminalArgumentsEvent(events)).toEqual({
      type: "tool_call_delta",
      id: "fc_123",
      name: "get_weather",
      argumentsDelta: '{"city":"Jakarta"}',
      argumentsMode: "replace",
    });
  });

  it("resolves an omitted Azure arguments.done name from output_item.added", async () => {
    const events = await collectResponsesStream(
      openAIResponsesModelWithStream(weatherToolCallStream({ omitDoneName: true })),
    );

    expect(terminalArgumentsEvent(events)).toEqual({
      type: "tool_call_delta",
      id: "fc_123",
      name: "get_weather",
      argumentsDelta: '{"city":"Jakarta"}',
      argumentsMode: "replace",
    });
  });

  it("rejects arguments.done when no function name can be resolved", async () => {
    const model = openAIResponsesModelWithStream([
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_123",
        delta: '{"city":"Jakarta"}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_123",
        arguments: '{"city":"Jakarta"}',
      },
    ]);

    await expect(collectResponsesStream(model)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call", { toolCallId: "fc_123" }),
    );
  });

  it("rejects an arguments.done name that conflicts with output_item.added", async () => {
    const model = openAIResponsesModelWithStream(
      weatherToolCallStream({ doneName: "get_forecast" }),
    );

    await expect(collectResponsesStream(model)).rejects.toMatchObject(
      providerOutputError("invalid-tool-call", { toolCallId: "fc_123" }),
    );
  });

  it("executes one tool call with complete arguments when delta and done are both present", async () => {
    const toolExecutions: unknown[] = [];
    let requestCount = 0;
    const model = new OpenAIResponsesCompletionModel(
      {
        responses: {
          create: async () => {
            const events =
              requestCount++ === 0
                ? weatherToolCallStream({ omitDoneName: true })
                : completedTextStream();
            return streamOf(events);
          },
        },
      } as never,
      "responses-test",
    );
    const agent = new Agent({
      id: "azure-responses-tool-stream",
      model,
      tools: [recordingTool("get_weather", toolExecutions)],
    });

    const events = await collectEvents(agent.stream({ prompt: "Get the weather." }));

    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(1);
    expect(toolExecutions).toEqual([{ city: "Jakarta" }]);
  });
});

function terminalArgumentsEvent(
  events: CompletionModelStreamEvent[],
): CompletionModelStreamEvent | undefined {
  return events.find(
    (event) => event.type === "tool_call_delta" && event.argumentsMode === "replace",
  );
}

function weatherToolCallStream(
  options: { omitDoneName?: boolean; doneName?: string } = {},
): unknown[] {
  const functionCall = {
    type: "function_call",
    id: "fc_123",
    status: "completed",
    name: "get_weather",
    call_id: "call_123",
    arguments: '{"city":"Jakarta"}',
  };
  const argumentsDone: Record<string, unknown> = {
    type: "response.function_call_arguments.done",
    item_id: functionCall.id,
    arguments: functionCall.arguments,
  };
  if (options.omitDoneName !== true) {
    argumentsDone.name = options.doneName ?? functionCall.name;
  }

  return [
    {
      type: "response.output_item.added",
      item: { ...functionCall, status: "in_progress", arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: functionCall.id,
      delta: '{"city":',
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: functionCall.id,
      delta: '"Jakarta"}',
    },
    argumentsDone,
    { type: "response.output_item.done", item: functionCall },
    {
      type: "response.completed",
      response: {
        id: "resp_123",
        status: "completed",
        output: [functionCall],
        usage: {},
      },
    },
  ];
}

function completedTextStream(): unknown[] {
  return [
    {
      type: "response.completed",
      response: {
        id: "resp_456",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Weather retrieved." }],
          },
        ],
        usage: {},
      },
    },
  ];
}

function openAIResponsesModelWithStream(events: unknown[]): OpenAIResponsesCompletionModel {
  return new OpenAIResponsesCompletionModel(
    { responses: { create: async () => streamOf(events) } } as never,
    "responses-test",
  );
}

function streamOf(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

async function collectResponsesStream(
  model: OpenAIResponsesCompletionModel,
): Promise<CompletionModelStreamEvent[]> {
  return collectEvents(
    model.streamCompletion({
      chatHistory: [Message.user("Call a tool.")],
      documents: [],
      tools: [],
    }),
  );
}

async function collectEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
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
