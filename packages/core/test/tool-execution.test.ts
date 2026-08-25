import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  type AnyTool,
  type CompletionModel,
  createTool,
  type Tool,
  ToolCallError,
  ToolJsonError,
  ToolNotFoundError,
  ToolOutput,
} from "./helpers/imports";

const model: CompletionModel = {
  provider: "test",
  modelId: "test",
  capabilities: {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  },
  async completion() {
    throw new Error("Tool execution tests do not run completions.");
  },
};

function agentWithTools(tools: readonly AnyTool[] = []): Agent {
  return new Agent({ id: "tool-execution", model, tools });
}

const addTool = createTool({
  name: "add",
  description: "Add two numbers",
  inputSchema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  outputSchema: z.number(),
  execute: (args) => args.x + args.y,
});

describe("Agent tool execution", () => {
  it("registers, defines, and calls tools", async () => {
    const agent = agentWithTools([addTool]);

    await expect(Promise.all(agent.tools.map((tool) => tool.definition("")))).resolves.toEqual([
      {
        name: "add",
        description: "Add two numbers",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
    ]);
    await expect(agent.callTool("add", JSON.stringify({ x: 2, y: 5 }))).resolves.toEqual({
      type: "json",
      value: 7,
    });
  });

  it("stores approval metadata without adding it to tool definitions", async () => {
    const approvedTool = createTool({
      name: "approved",
      description: "Needs conditional approval",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.string(),
      requiresApproval: ({ amount }) => (amount > 100 ? { reason: `Approve ${amount}` } : false),
      execute: () => "ok",
    });
    const agent = agentWithTools([approvedTool]);

    expect(agent.getTool("approved")?.requiresApproval).toBe(approvedTool.requiresApproval);
    await expect(Promise.all(agent.tools.map((tool) => tool.definition("")))).resolves.toEqual([
      {
        name: "approved",
        description: "Needs conditional approval",
        parameters: {
          type: "object",
          properties: {
            amount: { type: "number" },
          },
          required: ["amount"],
          additionalProperties: false,
        },
      },
    ]);
    await expect(agent.callTool("approved", JSON.stringify({ amount: 250 }))).resolves.toEqual({
      type: "text",
      value: "ok",
    });
  });

  it("throws for missing tools", async () => {
    const agent = agentWithTools();

    await expect(agent.callTool("missing", "{}")).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("throws for invalid JSON arguments", async () => {
    const agent = agentWithTools([addTool]);

    await expect(agent.callTool("add", "{")).rejects.toBeInstanceOf(ToolJsonError);
  });

  it("rejects non-finite parsed arguments before a tool executes", async () => {
    let executions = 0;
    const tool = createTool({
      name: "permissive",
      description: "Accept any input",
      inputSchema: z.any(),
      execute: () => {
        executions += 1;
        return "unexpected";
      },
    });
    const agent = agentWithTools([tool]);

    await expect(agent.callTool("permissive", '{"value":1e400}')).rejects.toBeInstanceOf(
      ToolJsonError,
    );
    expect(executions).toBe(0);
  });

  it("serializes string outputs without JSON quotes", async () => {
    const agent = agentWithTools([
      createTool({
        name: "echo",
        description: "Echo",
        inputSchema: z.object({}),
        execute: () => "hello",
      }),
    ]);

    await expect(agent.callTool("echo", "{}")).resolves.toEqual({ type: "text", value: "hello" });
  });

  it("throws tool call errors for invalid Zod input", async () => {
    const agent = agentWithTools([addTool]);

    await expect(agent.callTool("add", JSON.stringify({ x: "2", y: 5 }))).rejects.toBeInstanceOf(
      ToolCallError,
    );
  });

  it("validates output when an output schema is provided", async () => {
    const agent = agentWithTools([
      createTool({
        name: "bad_output",
        description: "Return bad output",
        inputSchema: z.object({}),
        outputSchema: z.number(),
        execute: () => "not a number" as unknown as number,
      }),
    ]);

    await expect(agent.callTool("bad_output", "{}")).rejects.toBeInstanceOf(ToolCallError);
  });

  it("applies input and output schema transformations", async () => {
    let executedAmount: number | undefined;
    const transformedTool = createTool({
      name: "transform",
      description: "Transform input and output",
      inputSchema: z.object({ amount: z.coerce.number() }),
      outputSchema: z.number().transform((total) => ({ total })),
      requiresApproval: ({ amount }) => amount > 100,
      execute: ({ amount }) => {
        executedAmount = amount;
        return amount * 2;
      },
    });
    const agent = agentWithTools([transformedTool]);

    expect(transformedTool.parseInput?.({ amount: "125" })).toEqual({ amount: 125 });
    await expect(agent.callTool("transform", JSON.stringify({ amount: "21" }))).resolves.toEqual({
      type: "json",
      value: { total: 42 },
    });
    expect(executedAmount).toBe(21);
  });

  it("allows arbitrary output when output schema is omitted", async () => {
    const agent = agentWithTools([
      createTool({
        name: "object_output",
        description: "Return object output",
        inputSchema: z.object({}),
        execute: () => ({ ok: true }),
      }),
    ]);

    await expect(agent.callTool("object_output", "{}")).resolves.toEqual({
      type: "json",
      value: { ok: true },
    });
  });

  it("passes through structured tool result content", async () => {
    const content = ToolOutput.content([
      { type: "text", text: '{"coordMap":"0,0,100,100,100,100"}' },
      {
        type: "file",
        data: { type: "data", data: "iVBORw0KGgo=" },
        mediaType: "image/png",
      },
    ]);
    const agent = agentWithTools([
      createTool({
        name: "screenshot",
        description: "Return screenshot",
        inputSchema: z.object({}),
        execute: () => content,
      }),
    ]);

    await expect(agent.callTool("screenshot", "{}")).resolves.toEqual({
      type: "content",
      value: content.content,
    });
  });

  it("recognizes structured output branded by another Core module instance", async () => {
    const content = [{ type: "text" as const, text: "cross-instance output" }];
    const externalOutput = {
      [Symbol.for("anvia.tool-output.content")]: true,
      content,
    };
    const agent = agentWithTools([
      createTool({
        name: "external_output",
        description: "Return output from another Core instance",
        inputSchema: z.object({}),
        execute: () => externalOutput,
      }),
    ]);

    await expect(agent.callTool("external_output", "{}")).resolves.toEqual({
      type: "content",
      value: content,
    });
  });

  it("rejects malformed rich tool result content", async () => {
    const agent = agentWithTools([
      createTool({
        name: "invalid_file",
        description: "Return malformed rich content",
        inputSchema: z.object({}),
        execute: () =>
          ToolOutput.content([
            {
              type: "file",
              data: { type: "data", data: "not-base64!" },
              mediaType: "image/png",
            },
          ]),
      }),
    ]);

    await expect(agent.callTool("invalid_file", "{}")).rejects.toThrow(
      "Tool output must be a string, a strict JSON value, or ToolOutput.content",
    );
  });

  it("uses the prepared input contract for direct tool calls", async () => {
    const received: unknown[] = [];
    const tool: AnyTool = {
      name: "coerce",
      definition: () => ({
        name: "coerce",
        description: "Coerce a numeric string",
        parameters: { type: "object", properties: {} },
      }),
      parseInput(args) {
        return Number((args as { value: string }).value);
      },
      call(args) {
        received.push(args);
        return args;
      },
    };
    const agent = agentWithTools([tool]);

    await expect(agent.callTool("coerce", '{"value":"3"}')).resolves.toEqual({
      type: "json",
      value: 3,
    });
    expect(received).toEqual([3]);
  });

  it("preserves nullish parsed inputs instead of falling back to raw input", async () => {
    const received: unknown[] = [];
    const nullTool: AnyTool = {
      name: "null_input",
      definition: () => ({
        name: "null_input",
        description: "Transform input to null",
        parameters: { type: "object", properties: {} },
      }),
      parseInput: () => null,
      call(input) {
        received.push(input);
        return "null";
      },
    };
    const undefinedTool: AnyTool = {
      name: "undefined_input",
      definition: () => ({
        name: "undefined_input",
        description: "Transform input to undefined",
        parameters: { type: "object", properties: {} },
      }),
      parseInput: () => undefined,
      call(input) {
        received.push(input);
        return "undefined";
      },
    };
    const agent = agentWithTools([nullTool, undefinedTool]);

    await expect(agent.callTool("null_input", "{}")).resolves.toEqual({
      type: "text",
      value: "null",
    });
    await expect(agent.callTool("undefined_input", "{}")).resolves.toEqual({
      type: "text",
      value: "undefined",
    });
    expect(received).toEqual([null, undefined]);
  });

  it("consumes prepared-input state before a tool re-enters itself", async () => {
    let recursiveTool: Tool<{ value: string }, string>;
    recursiveTool = createTool({
      name: "recursive",
      description: "Call itself once",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute({ value }, context) {
        return value === "outer" ? recursiveTool.call({ value: "nested" }, context) : value;
      },
    });
    const agent = agentWithTools([recursiveTool]);

    await expect(agent.callTool("recursive", '{"value":"outer"}')).resolves.toEqual({
      type: "text",
      value: "nested",
    });
  });

  it("snapshots createTool options and returns independent definitions", async () => {
    const options = {
      name: "before",
      description: "Before mutation",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute: ({ value }: { value: string }) => `before:${value}`,
    };
    const tool = createTool(options);

    options.name = "after";
    options.description = "After mutation";
    options.execute = ({ value }) => `after:${value}`;
    const firstDefinition = await tool.definition("");
    (firstDefinition.parameters as { type?: string }).type = "corrupted";
    const secondDefinition = await tool.definition("");

    expect(tool.name).toBe("before");
    expect(secondDefinition).toMatchObject({
      name: "before",
      description: "Before mutation",
      parameters: { type: "object" },
    });
    await expect(agentWithTools([tool]).callTool("before", '{"value":"ok"}')).resolves.toEqual({
      type: "text",
      value: "before:ok",
    });
  });

  it("rejects repeated tool registrations", () => {
    const echoTool = createTool({
      name: "echo",
      description: "Echo",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute: ({ value }) => value,
    });

    expect(() => agentWithTools([addTool, addTool, echoTool])).toThrow(
      'Duplicate local tool name "add"',
    );
  });

  it("rejects distinct tools with the same name", () => {
    const replacement = createTool({
      name: "add",
      description: "Replace add",
      inputSchema: z.object({ x: z.number(), y: z.number() }),
      outputSchema: z.number(),
      execute: ({ x, y }) => x * y,
    });
    expect(() => agentWithTools([addTool, replacement])).toThrow('Duplicate local tool name "add"');
  });
});
