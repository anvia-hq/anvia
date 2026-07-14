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
  createMiddleware,
  createTool,
  createToolMiddleware,
  MaxTurnsError,
  Message,
  PromptCancelledError,
  requestToolApproval,
  ToolApprovalRequiredError,
  ToolOutput,
  Usage,
} from "./helpers/imports";

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

function textFromChoice(choice: CompletionResponse["choice"]): string {
  return choice
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
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

  it("send consumes steering queued before no-tool finalization", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("first")]),
      response([AssistantContent.text("second")]),
    ]);
    let steer: ((input: string) => boolean) | undefined;
    const agent = new AgentBuilder("test-agent", model)
      .hook(
        createHook({
          onTurnEnd({ turn }) {
            if (turn === 1) {
              expect(steer?.("revise")).toBe(true);
            }
          },
        }),
      )
      .build();
    const request = agent.prompt("hello");
    steer = request.steer.bind(request);

    const result = await request.send();

    expect(result.output).toBe("second");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(Message.user("revise"));
    expect(result.messages).toEqual([
      Message.user("hello"),
      Message.assistant("first"),
      Message.user("revise"),
      Message.assistant("second"),
    ]);
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
          toolName: "add",
          content: [{ type: "text", text: "7" }],
        },
      ]),
    );
  });

  it("rejects empty completion tool names before dispatch", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("tool_0", "", { command: "pwd" }, "call_abc")]),
      response([AssistantContent.text("should not continue")]),
    ]);
    const agent = new AgentBuilder("test-agent", model).build();

    await expect(agent.prompt("run a command").send()).rejects.toThrow(
      'Completion returned tool call "tool_0" with an empty function name; this indicates invalid provider output or provider mapping.',
    );
    expect(model.requests).toHaveLength(1);
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

  it("runs tool result middleware before hooks and the next model turn", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 }, "fc_1")]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const outputGate = createToolMiddleware({
      onResult({ toolName, result, originalResult, toolCallId }) {
        events.push(`${toolName}:${toolCallId}:${originalResult}`);
        return `stored:${result}`;
      },
    });
    const hook = createHook({
      onToolResult({ result }) {
        events.push(`hook:${result}`);
      },
    });
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .toolMiddleware(outputGate)
      .hook(hook)
      .build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(["add:fc_1:7", "hook:stored:7"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          toolName: "add",
          content: [{ type: "text", text: "stored:7" }],
        },
      ]),
    );
  });

  it("sends structured tool result content to the next model turn", async () => {
    const structuredContent = ToolOutput.content([
      { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
      { type: "image", data: "base64-png", mediaType: "image/png" },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      input: z.object({}),
      execute: () => structuredContent,
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "computer_screenshot", {}, "fc_1")]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const hook = createHook({
      onToolResult({ result, structuredResult }) {
        events.push(`${result}:${structuredResult?.length ?? 0}`);
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(screenshotTool).hook(hook).build();

    await expect(agent.prompt("screenshot").send()).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(['{"coordMap":"0,0,100,100,100,100"}\n[image:image/png]:2']);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          callId: "fc_1",
          toolName: "computer_screenshot",
          content: structuredContent,
        },
      ]),
    );
  });

  it("lets middleware observe structured results and replace them with text", async () => {
    const structuredContent = ToolOutput.content([
      { type: "text", text: "screen" },
      { type: "image", data: "base64-png", mediaType: "image/png" },
    ]);
    const screenshotTool = createTool({
      name: "computer_screenshot",
      description: "Return screenshot",
      input: z.object({}),
      execute: () => structuredContent,
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "computer_screenshot", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const seen: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .tool(screenshotTool)
      .toolMiddleware(
        createToolMiddleware({
          onResult({ result, structuredResult, originalStructuredResult }) {
            seen.push(
              `${result}:${structuredResult?.length ?? 0}:${originalStructuredResult?.length ?? 0}`,
            );
            return "stored:screenshot";
          },
        }),
      )
      .build();

    await expect(agent.prompt("screenshot").send()).resolves.toMatchObject({ output: "done" });

    expect(seen).toEqual(["screen\n[image:image/png]:2:2"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "computer_screenshot",
          content: [{ type: "text", text: "stored:screenshot" }],
        },
      ]),
    );
  });

  it("composes agent and request tool result middleware in order", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const keep = createToolMiddleware({
      onResult({ result, originalResult }) {
        events.push(`keep:${result}:${originalResult}`);
        return undefined;
      },
    });
    const agentAppend = createToolMiddleware({
      onResult({ result, originalResult }) {
        events.push(`agent:${result}:${originalResult}`);
        return `${result}:agent`;
      },
    });
    const requestAppend = createToolMiddleware({
      onResult({ result, originalResult }) {
        events.push(`request:${result}:${originalResult}`);
        return `${result}:request`;
      },
    });
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .toolMiddlewares([keep, agentAppend])
      .build();

    await expect(
      agent.prompt("add").withToolMiddleware(requestAppend).send(),
    ).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(["keep:7:7", "agent:7:7", "request:7:agent:7"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7:agent:request" }],
        },
      ]),
    );
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

  it("runs lifecycle hooks around prompt turns", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .hook(
        createHook({
          onRunStart({ prompt, history, maxTurns }) {
            events.push(`run_start:${prompt.role}:${history.length}:${maxTurns}`);
          },
          onTurnStart({ turn, prompt, history }) {
            events.push(`turn_start:${turn}:${prompt.role}:${history.length}`);
          },
          onTurnEnd({ turn, response }) {
            events.push(`turn_end:${turn}:${response.choice.length}`);
          },
          onRunEnd({ output, messages }) {
            events.push(`run_end:${output}:${messages.length}`);
          },
        }),
      )
      .build();

    await expect(agent.prompt("hello").send()).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual([
      "run_start:user:0:20",
      "turn_start:1:user:0",
      "turn_end:1:1",
      "run_end:done:2",
    ]);
  });

  it("runs completion middleware before the model and before response hooks", async () => {
    const model = new QueueModel([response([AssistantContent.text("original")])]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .middleware(
        createMiddleware({
          onCompletionRequest({ request, originalRequest }) {
            events.push(
              `request:${request.chatHistory.length}:${originalRequest.chatHistory.length}`,
            );
            return {
              request: {
                ...request,
                instructions: "middleware instructions",
              },
            };
          },
          onCompletionResponse({ response, originalResponse }) {
            events.push(
              `response:${textFromChoice(response.choice)}:${textFromChoice(originalResponse.choice)}`,
            );
            return {
              response: {
                ...response,
                choice: [AssistantContent.text("changed")],
              },
            };
          },
        }),
      )
      .hook(
        createHook({
          onCompletionResponse({ response }) {
            events.push(`hook:${textFromChoice(response.choice)}`);
          },
        }),
      )
      .build();

    await expect(agent.prompt("hello").send()).resolves.toMatchObject({ output: "changed" });

    expect(model.requests[0]?.instructions).toBe("middleware instructions");
    expect(events).toEqual(["request:1:1", "response:original:original", "hook:changed"]);
  });

  it("runs tool input and output middleware through the new API", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 1, y: 1 })]),
      response([AssistantContent.text("done")]),
    ]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .middleware(
        createMiddleware({
          onToolInput({ args, originalArgs }) {
            events.push(`input:${args}:${originalArgs}`);
            return { args: { x: 2, y: 5 } };
          },
          onToolOutput({ result, originalResult, args }) {
            events.push(`output:${result}:${originalResult}:${args}`);
            return { result: `stored:${result}` };
          },
        }),
      )
      .build();

    await expect(agent.prompt("add").send()).resolves.toMatchObject({ output: "done" });

    expect(events).toEqual(['input:{"x":1,"y":1}:{"x":1,"y":1}', 'output:7:7:{"x":2,"y":5}']);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "stored:7" }],
        },
      ]),
    );
  });

  it("composes new and deprecated middleware registrations in order", async () => {
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "add", { x: 2, y: 5 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(addTool)
      .middlewares([
        createMiddleware({
          onToolOutput({ result }) {
            return { result: `${result}:agent` };
          },
        }),
      ])
      .build();

    await expect(
      agent
        .prompt("add")
        .withMiddlewares([
          createMiddleware({
            onToolOutput({ result }) {
              return { result: `${result}:request` };
            },
          }),
        ])
        .withToolMiddleware(
          createToolMiddleware({
            onResult({ result }) {
              return `${result}:legacy`;
            },
          }),
        )
        .send(),
    ).resolves.toMatchObject({ output: "done" });

    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "add",
          content: [{ type: "text", text: "7:agent:request:legacy" }],
        },
      ]),
    );
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
          toolName: "add",
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
          toolName: "add",
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

  it("throws clearly when a tool call hook requests approval without a handler", async () => {
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
      response([AssistantContent.text("should not be requested")]),
    ]);
    const hook = createHook({
      onToolCall({ tool }) {
        return tool.requestApproval({ reason: "Guarded action." });
      },
    });
    const agent = new AgentBuilder("test-agent", model).tool(guardedTool).hook(hook).build();

    await expect(agent.prompt("run guarded").send()).rejects.toBeInstanceOf(
      ToolApprovalRequiredError,
    );
    expect(executed).toBe(false);
    expect(model.requests).toHaveLength(1);
  });

  it("routes hook-based approval requests through the approval handler", async () => {
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
          onToolCall({ tool }) {
            return tool.requestApproval({ reason: "Guarded action." });
          },
        }),
      )
      .approvals({ handler: () => true })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
  });

  it("skips hook-based approval requests when the approval handler rejects", async () => {
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
          onToolCall({ tool }) {
            return tool.requestApproval({ rejectMessage: "Rejected by hook." });
          },
        }),
      )
      .approvals({ handler: () => false })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "denied" });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Rejected by hook." }],
        },
      ]),
    );
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
          toolName: "guarded",
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
          toolName: "guarded",
          content: [{ type: "text", text: "Rejected by policy." }],
        },
      ]),
    );
  });

  it("runs approval-protected tools when the handler approves", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({ amount: z.number() }),
      output: z.string(),
      approval: {
        when: ({ args }) => args.amount > 100,
        reason: ({ args }) => `Approve ${args.amount}`,
      },
      execute({ amount }) {
        executed = true;
        return `approved ${amount}`;
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 250 })]),
      response([AssistantContent.text("done")]),
    ]);
    const requests: unknown[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .approvals({
        handler(request) {
          requests.push(request);
          return true;
        },
      })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
    expect(requests).toMatchObject([
      {
        toolName: "guarded",
        args: { amount: 250 },
        reason: "Approve 250",
        run: { agentId: "test-agent" },
      },
    ]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "approved 250" }],
        },
      ]),
    );
  });

  it("evaluates tool approval after tool input middleware changes args", async () => {
    let executedAmount: number | undefined;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({ amount: z.number() }),
      output: z.string(),
      approval: {
        when: ({ args }) => args.amount > 100,
        reason: ({ args }) => `Approve ${args.amount}`,
      },
      execute({ amount }) {
        executedAmount = amount;
        return `approved ${amount}`;
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 50 })]),
      response([AssistantContent.text("done")]),
    ]);
    const approvalRequests: unknown[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .middleware(
        createMiddleware({
          onToolInput() {
            return { args: { amount: 250 } };
          },
        }),
      )
      .approvals({
        handler(request) {
          approvalRequests.push(request);
          return true;
        },
      })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "done" });

    expect(executedAmount).toBe(250);
    expect(approvalRequests).toMatchObject([
      {
        toolName: "guarded",
        args: { amount: 250 },
        rawArgs: '{"amount":250}',
        reason: "Approve 250",
      },
    ]);
  });

  it("skips approval-protected tools when the handler rejects", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({ amount: z.number() }),
      output: z.string(),
      approval: {
        when: ({ args }) => args.amount > 100,
        rejectMessage: "Rejected by policy.",
      },
      execute() {
        executed = true;
        return "should not run";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 250 })]),
      response([AssistantContent.text("denied")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .approvals({ handler: () => false })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "denied" });
    expect(executed).toBe(false);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "guarded",
          content: [{ type: "text", text: "Rejected by policy." }],
        },
      ]),
    );
  });

  it("runs approval-protected tools directly when the condition is false", async () => {
    let approvals = 0;
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({ amount: z.number() }),
      output: z.string(),
      approval: {
        when: ({ args }) => args.amount > 100,
      },
      execute() {
        executed = true;
        return "safe result";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", { amount: 50 })]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .approvals({
        handler() {
          approvals += 1;
          return false;
        },
      })
      .build();

    await expect(agent.prompt("run guarded").send()).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
    expect(approvals).toBe(0);
  });

  it("lets request-level approvals override agent-level approvals", async () => {
    let executed = false;
    const guardedTool = createTool({
      name: "guarded",
      description: "A guarded tool",
      input: z.object({}),
      output: z.string(),
      approval: {
        when: () => true,
        rejectMessage: "Rejected by request.",
      },
      execute() {
        executed = true;
        return "request approved";
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "guarded", {})]),
      response([AssistantContent.text("done")]),
    ]);
    const agent = new AgentBuilder("test-agent", model)
      .tool(guardedTool)
      .approvals({ handler: () => false })
      .build();

    await expect(
      agent
        .prompt("run guarded")
        .approvals({ handler: () => true })
        .send(),
    ).resolves.toMatchObject({ output: "done" });
    expect(executed).toBe(true);
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

  it("runs completion error hooks before run error hooks", async () => {
    const model = new QueueModel([]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .hook(
        createHook({
          onCompletionError({ error }) {
            events.push(`completion_error:${error instanceof Error ? error.message : error}`);
          },
          onRunError({ error }) {
            events.push(`run_error:${error instanceof Error ? error.message : error}`);
          },
        }),
      )
      .build();

    await expect(agent.prompt("hello").send()).rejects.toThrow("No queued response");

    expect(events).toEqual(["completion_error:No queued response", "run_error:No queued response"]);
  });

  it("rejects steering after final, error, and cancel", async () => {
    const finalModel = new QueueModel([response([AssistantContent.text("done")])]);
    const finalAgent = new AgentBuilder("test-agent", finalModel).build();
    const finalRequest = finalAgent.prompt("hello");

    const result = await finalRequest.send();
    const finalMessages = [...result.messages];

    expect(finalRequest.steer("late")).toBe(false);
    expect(result.messages).toEqual(finalMessages);
    expect(finalModel.requests).toHaveLength(1);

    const errorRequest = new AgentBuilder("test-agent", new QueueModel([])).build().prompt("hello");
    await expect(errorRequest.send()).rejects.toThrow("No queued response");
    expect(errorRequest.steer("late")).toBe(false);

    const cancelRequest = new AgentBuilder("test-agent", new QueueModel([]))
      .hook(
        createHook({
          onRunStart() {
            return cancelPrompt("stop");
          },
        }),
      )
      .build()
      .prompt("hello");
    await expect(cancelRequest.send()).rejects.toBeInstanceOf(PromptCancelledError);
    expect(cancelRequest.steer("late")).toBe(false);
  });

  it("rejects reused prompt requests", async () => {
    const model = new QueueModel([response([AssistantContent.text("done")])]);
    const agent = new AgentBuilder("test-agent", model).build();
    const request = agent.prompt("hello");

    await expect(request.send()).resolves.toMatchObject({ output: "done" });
    await expect(request.send()).rejects.toThrow("PromptRequest has already been used.");
  });

  it("runs tool error hooks and keeps tool errors as model-visible results", async () => {
    const failingTool = createTool({
      name: "fail",
      description: "Fail",
      input: z.object({}),
      output: z.string(),
      execute() {
        throw new Error("tool failed");
      },
    });
    const model = new QueueModel([
      response([AssistantContent.toolCall("call_1", "fail", {})]),
      response([AssistantContent.text("handled")]),
    ]);
    const events: string[] = [];
    const agent = new AgentBuilder("test-agent", model)
      .tool(failingTool)
      .hook(
        createHook({
          onToolError({ toolName, error }) {
            events.push(`${toolName}:${error instanceof Error ? error.message : error}`);
          },
        }),
      )
      .build();

    await expect(agent.prompt("fail").send()).resolves.toMatchObject({ output: "handled" });

    expect(events).toEqual(["fail:tool failed"]);
    expect(model.requests[1]?.chatHistory.at(-1)).toEqual(
      Message.tool([
        {
          type: "tool_result",
          id: "call_1",
          toolName: "fail",
          content: [{ type: "text", text: "ToolCallError: tool failed" }],
        },
      ]),
    );
  });

  it("keeps low-level hook action helpers available", () => {
    expect(cancelPrompt("blocked")).toEqual({ type: "terminate", reason: "blocked" });
    expect(requestToolApproval({ reason: "review" })).toEqual({
      type: "approval_request",
      reason: "review",
    });
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
          toolName: "add",
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
