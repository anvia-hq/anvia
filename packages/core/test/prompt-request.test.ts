import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentBuilder,
  AssistantContent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  cancelPrompt,
  createHook,
  createTool,
  MaxTurnsError,
  Message,
  PromptCancelledError,
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
  execute: (args) => args.x + args.y,
});

describe("PromptRequest", () => {
  it("returns text-only completions", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model).instructions("system").build();

    const result = await agent.prompt("hello").send();

    expect(result.output).toBe("done");
    expect(model.requests[0]?.instructions).toBe("system");
    expect(model.requests[0]?.chatHistory[0]).toEqual(Message.user("hello"));
  });

  it("merges repeated instruction blocks", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model)
      .instructions("First block.")
      .instructions("Second block.")
      .build();

    await agent.prompt("hello").send();

    expect(model.requests[0]?.instructions).toBe("First block.\n\nSecond block.");
  });

  it("executes one tool round-trip", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("7")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).build();

    const result = await agent.prompt("add").send();

    expect(result.output).toBe("7");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.at(-2)?.role).toBe("assistant");
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("executes multiple tool calls in one turn", async () => {
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 }),
        AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 }),
      ]),
      response([AssistantContent.text("ok")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).build();

    await expect(agent.prompt("add twice").withToolConcurrency(2).send()).resolves.toMatchObject({
      output: "ok",
    });
    const finalToolMessage = model.requests[1]?.chatHistory.at(-1);
    expect(finalToolMessage?.role).toBe("tool");
    expect(finalToolMessage?.role === "tool" ? finalToolMessage.content : []).toHaveLength(2);
  });

  it("runs object-shaped hooks and continues when callbacks return nothing", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("7")]),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onCompletionCall({ prompt, history }) {
        events.push(`completion_call:${prompt.role}:${history.length}`);
      },
      onCompletionResponse({ response }) {
        events.push(`completion_response:${response.choice.length}`);
      },
      onToolCall({ toolName, toolCallId, args }) {
        events.push(`tool_call:${toolName}:${toolCallId}:${args}`);
      },
      onToolResult({ toolName, result }) {
        events.push(`tool_result:${toolName}:${result}`);
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(addTool).hook(hook).build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "7" });

    expect(events).toEqual([
      "completion_call:user:0",
      "completion_response:1",
      'tool_call:add:fc_1:{"x":2,"y":5}',
      "tool_result:add:7",
      "completion_call:tool:2",
      "completion_response:1",
    ]);
  });

  it("can run tool calls from a hook helper", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("7")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.run();
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(addTool).hook(hook).build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "7" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("can skip tool calls from a hook helper", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("skipped")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.skip("not needed");
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(addTool).hook(hook).build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "skipped" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          content: [{ type: "text", text: "not needed" }],
        },
      ]),
    );
  });

  it("can cancel prompts from a tool call hook helper before execution", async () => {
    let executed = false;
    const blockedTool = createTool({
      name: "blocked",
      description: "A tool that should not run",
      input: z.object({}),
      output: z.string(),
      execute() {
        executed = true;
        return "ran";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "blocked", {})]),
      response([AssistantContent.text("should not be requested")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.cancel("blocked");
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(blockedTool).hook(hook).build();

    await expect(agent.prompt("run blocked").send()).rejects.toMatchObject({
      name: "PromptCancelledError",
      reason: "blocked",
    });
    expect(executed).toBe(false);
    expect(model.requests).toHaveLength(1);
  });

  it("executes a tool after async approval-style hook allows it", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({}),
      output: z.string(),
      execute() {
        executed = true;
        return "approved result";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .hook(
        createHook({
          async onToolCall({ tool }) {
            const approved = await Promise.resolve(true);
            return approved ? tool.run() : tool.skip("not approved");
          },
        }),
      )
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          content: [{ type: "text", text: "approved result" }],
        },
      ]),
    );
  });

  it("skips a tool after async approval-style hook rejects it", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({}),
      output: z.string(),
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("denied")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .hook(
        createHook({
          async onToolCall({ tool }) {
            const approved = await Promise.resolve(false);
            return approved ? tool.run() : tool.skip("Rejected by policy.");
          },
        }),
      )
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "denied" });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          content: [{ type: "text", text: "Rejected by policy." }],
        },
      ]),
    );
  });

  it("can cancel prompts from a hook helper", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const hook = createHook({
      onCompletionCall({ run }) {
        return run.cancel("blocked");
      },
    });
    const agent = new AgentBuilder("test-agent", model).hook(hook).build();

    await expect(agent.prompt("hello").send()).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it("keeps low-level hook action helpers available", () => {
    expect(cancelPrompt("blocked")).toEqual({ type: "terminate", reason: "blocked" });
  });

  it("uses requestHook for one request instead of the agent hook", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("request hook used")]),
    ]);
    const agentHook = createHook({
      onToolCall({ tool }) {
        return tool.skip("agent hook used");
      },
    });
    const requestHook = createHook({
      onToolCall({ tool }) {
        return tool.run();
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(addTool).hook(agentHook).build();

    await expect(agent.prompt("add").requestHook(requestHook).send()).resolves.toMatchObject({
      output: "request hook used",
    });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("fails when the model keeps calling tools past max turns", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 2 })]),
      response([AssistantContent.toolCall("call_2", "add", { x: 3, y: 4 })]),
    ]);
    const agent = new AgentBuilder("test-agent", model).tool(addTool).defaultMaxTurns(0).build();

    await expect(agent.prompt("loop").send()).rejects.toBeInstanceOf(MaxTurnsError);
  });

  it("converts Zod output schemas into completion request JSON Schema", async () => {
    const model = new QueueModel([response([AssistantContent.text('{"title":"ok"}')])]);
    const agent = new AgentBuilder("test-agent", model)
      .outputSchema(z.object({ title: z.string() }).meta({ title: "summary_response" }))
      .build();

    await agent.prompt("summarize").send();

    expect(model.requests[0]?.outputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
      title: "summary_response",
    });
  });
});
