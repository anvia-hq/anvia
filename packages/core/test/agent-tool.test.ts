import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  MaxTurnsError,
  ToolSet,
  Usage,
} from "../src/index";

class QueueModel implements CompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

const addTool = createTool({
  name: "add",
  description: "Add numbers",
  input: z.object({
    x: z.number(),
    y: z.number(),
  }),
  output: z.number(),
  execute: ({ x, y }) => x + y,
});

describe("Agent.asTool", () => {
  it("stores a stable trimmed agent id", () => {
    const model = new QueueModel([]);
    const agent = new AgentBuilder(" support ", model).build();

    expect(agent.id).toBe("support");
  });

  it("rejects empty agent ids", () => {
    const model = new QueueModel([]);

    expect(() => new AgentBuilder("", model)).toThrow(TypeError);
    expect(() => new AgentBuilder("   ", model)).toThrow(TypeError);
    expect(() => new AgentBuilder(undefined as unknown as string, model)).toThrow(TypeError);
  });

  it("creates a tool definition from an agent", async () => {
    const model = new QueueModel([]);
    const agent = new AgentBuilder("test-agent", model)
      .description("Answer support questions.")
      .build();
    const tool = agent.asTool({ name: "ask_support" });

    await expect(Promise.resolve(tool.definition(""))).resolves.toEqual({
      name: "ask_support",
      description: "Answer support questions.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The prompt to send to the agent.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    });
  });

  it("delegates tool calls to the wrapped agent", async () => {
    const model = new QueueModel([response([AssistantContent.text("delegated")])]);
    const agent = new AgentBuilder("test-agent", model).build();
    const tool = agent.asTool({
      name: "ask_agent",
      description: "Ask an agent.",
    });

    await expect(tool.call({ prompt: "do work" })).resolves.toBe("delegated");
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "do work" }],
    });
  });

  it("applies maxTurns when provided", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 1 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 2, y: 2 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).defaultMaxTurns(3).build();
    const tool = agent.asTool({ name: "ask_agent", maxTurns: 0 });

    await expect(tool.call({ prompt: "loop" })).rejects.toBeInstanceOf(MaxTurnsError);
  });

  it("uses shared tool set updates made after agent creation", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const toolSet = new ToolSet();
    const agent = new AgentBuilder("test-agent", model)
      .useToolSet(toolSet)
      .defaultMaxTurns(1)
      .build();

    toolSet.addTool(addTool);

    await expect(agent.prompt("add numbers").send()).resolves.toMatchObject({ output: "done" });
    expect(model.requests[0]?.tools).toEqual([expect.objectContaining({ name: "add" })]);
  });

  it("copies existing builder tools into a shared tool set", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const toolSet = new ToolSet();
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .useToolSet(toolSet)
      .defaultMaxTurns(1)
      .build();

    expect(toolSet.get("add")).toBe(addTool);
    await expect(agent.prompt("add numbers").send()).resolves.toMatchObject({ output: "done" });
  });

  it("registers multiple wrapped agents as distinct tools", async () => {
    const first = new AgentBuilder(
      "test-agent",
      new QueueModel([response([AssistantContent.text("one")])]),
    )
      .build()
      .asTool({ name: "ask_one" });
    const second = new AgentBuilder(
      "test-agent",
      new QueueModel([response([AssistantContent.text("two")])]),
    )
      .build()
      .asTool({ name: "ask_two" });
    const toolSet = ToolSet.fromTools([first, second]);

    await expect(toolSet.call("ask_one", JSON.stringify({ prompt: "run" }))).resolves.toBe("one");
    await expect(toolSet.call("ask_two", JSON.stringify({ prompt: "run" }))).resolves.toBe("two");
  });
});
