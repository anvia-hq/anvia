import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  type AgentLifecycle,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createQuestionTool,
  createTool,
  createToolkit,
  isToolkit,
  normalizeAgentLifecycle,
  Usage,
} from "../src";
import type { EmbeddingModel } from "../src/embeddings";
import type { McpTool } from "../src/mcp/types";
import { createToolIndex, embedTools } from "../src/tool/dynamic-tools";
import { isQuestionTool } from "../src/tool/question-tool";
import { isSkillTool, markSkillTool } from "../src/tool/skill-tool-marker";

function createFakeModel(
  handler: (request: CompletionRequest) => Promise<CompletionResponse> | CompletionResponse,
): CompletionModel {
  return {
    provider: "fake",
    modelId: "fake-1",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: true,
      reasoning: false,
    },
    async completion(request) {
      return handler(request);
    },
  };
}

function createFakeEmbeddingModel(): EmbeddingModel {
  return {
    provider: "fake",
    modelId: "embed-1",
    dimensions: 3,
    async embedTexts(texts) {
      return texts.map((text) => ({
        document: text,
        vector: [
          text.includes("alpha") ? 1 : 0,
          text.includes("beta") ? 1 : 0,
          text.includes("gamma") ? 1 : 0,
        ],
      }));
    },
  };
}

describe("Toolkit", () => {
  const alpha = createTool({
    name: "alpha",
    description: "Run alpha task",
    inputSchema: z.object({ value: z.string() }),
    handler: ({ value }) => `alpha:${value}`,
  });

  const beta = createTool({
    name: "beta",
    description: "Run beta task",
    inputSchema: z.object({ count: z.number() }),
    requiresApproval: true,
    handler: ({ count }) => ({ doubled: count * 2 }),
  });

  it("creates a toolkit and supports include, exclude, prefix, approval, and instructions", async () => {
    const kit = createToolkit<"alpha" | "beta">(
      {
        name: "sample",
        tools: [alpha, beta],
        instructions: "Default sample instructions.",
      },
      {
        include: ["alpha", "beta"],
        exclude: ["alpha"],
        prefix: "my_",
        requiresApproval: { beta: false },
      },
    );

    expect(isToolkit(kit)).toBe(true);
    expect(kit.name).toBe("sample");
    expect(kit.instructions).toBe("Default sample instructions.");
    expect(kit.tools).toHaveLength(1);
    expect(kit.tools[0]?.name).toBe("my_beta");
    expect(kit.tools[0]?.requiresApproval).toBe(false);

    const def = await kit.tools[0]!.definition("");
    expect(def.name).toBe("my_beta");
    expect(await kit.tools[0]!.call({ count: 4 })).toEqual({ doubled: 8 });
  });

  it("validates toolkit shape, rejects blank names, unknown tool names, and MCP tools", () => {
    expect(isToolkit({ kind: "toolkit", name: "   ", tools: [] })).toBe(false);
    expect(isToolkit({ kind: "toolkit", name: "ok", tools: [], instructions: 123 })).toBe(false);

    const silent = createToolkit(
      { name: "silent", tools: [alpha], instructions: "Will be omitted" },
      { instructions: false },
    );
    expect(silent.instructions).toBeUndefined();

    expect(() => createToolkit({ name: "bad", tools: [alpha] }, { include: ["missing"] })).toThrow(
      /Unknown tool "missing"/,
    );

    expect(() =>
      createToolkit({ name: "bad", tools: [alpha] }, { requiresApproval: { missing: true } }),
    ).toThrow(/Unknown tool "missing"/);

    const mcpTool: McpTool = {
      name: "remote_ping",
      mcp: { serverName: "remote", remoteName: "ping" },
      definition: () => ({
        name: "remote_ping",
        description: "Remote ping",
        parameters: { type: "object", properties: {} },
      }),
      call: async () => "pong",
    };

    expect(() => createToolkit({ name: "bad-mcp", tools: [mcpTool] }, { prefix: "x_" })).toThrow(
      /Agent\.mcpServers/,
    );
  });

  it("preserves preparedToolOwnerSymbol for non-idempotent inputSchemas and question/skill markers when wrapped", async () => {
    let parseRuns = 0;
    const generatedDefault = createTool({
      name: "gen_num",
      description: "Generates default number once per call",
      inputSchema: z.object({
        num: z.number().default(() => {
          parseRuns += 1;
          return parseRuns * 10;
        }),
      }),
      handler: ({ num }) => ({ num }),
    });

    const questionTool = createQuestionTool();
    const skillTool = markSkillTool(
      createTool({
        name: "skill_helper",
        description: "Skill helper",
        inputSchema: z.object({}),
        handler: () => "ok",
      }),
    );

    const kit = createToolkit(
      { name: "markers", tools: [generatedDefault, questionTool, skillTool] },
      { prefix: "kit_", timeoutMs: 2_000 },
    );

    expect(isQuestionTool(kit.tools[1])).toBe(true);
    expect(isSkillTool(kit.tools[2])).toBe(true);

    const model = createFakeModel((request) => {
      const toolMsg = request.chatHistory.find((m) => m.role === "tool");

      if (toolMsg !== undefined) {
        return {
          choice: [{ type: "text", text: JSON.stringify(toolMsg.content) }],
          usage: Usage.empty(),
          rawResponse: {},
        };
      }

      return {
        choice: [
          {
            type: "tool-call",
            toolCallId: "call_t",
            toolName: "kit_gen_num",
            input: {},
          },
        ],
        usage: Usage.empty(),
        rawResponse: {},
      };
    });

    const agent = new Agent({ id: "transform-agent", model, tools: [kit] });
    await kit.tools[0]!.definition("");
    const runsBeforeCall = parseRuns;
    const outcome = await agent.generate({ prompt: "run gen_num" });
    expect(outcome.type).toBe("response");

    if (outcome.type === "response") {
      expect(outcome.output).toContain(String((runsBeforeCall + 1) * 10));
    }

    expect(parseRuns).toBe(runsBeforeCall + 1);
  });

  it("enforces timeoutMs and forwards abort signal to the underlying tool", async () => {
    let aborted = false;
    const slow = createTool({
      name: "slow",
      description: "Slow tool",
      inputSchema: z.object({}),
      handler: (_args, ctx) =>
        new Promise((resolve) => {
          ctx.abortSignal?.addEventListener("abort", () => {
            aborted = true;
          });
          setTimeout(() => resolve("done"), 500);
        }),
    });

    const kit = createToolkit({ name: "timed", tools: [slow] }, { timeoutMs: 25 });
    await expect(kit.tools[0]!.call({})).rejects.toThrow(/timed out after 25ms/);
    expect(aborted).toBe(true);
  });

  it("registers directly in Agent.tools, merges instructions, and detects collisions", async () => {
    const kit = createToolkit({
      name: "work",
      tools: [alpha],
      instructions: "Always call alpha before answering.",
    });

    let seenRequest: CompletionRequest | undefined;
    const model = createFakeModel((request) => {
      seenRequest = request;

      if (request.chatHistory.some((m) => m.role === "tool")) {
        return {
          choice: [{ type: "text", text: "finished" }],
          usage: Usage.empty(),
          rawResponse: {},
        };
      }

      return {
        choice: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "alpha",
            input: { value: "ok" },
          },
        ],
        usage: Usage.empty(),
        rawResponse: {},
      };
    });

    const agent = new Agent({
      id: "toolkit-agent",
      model,
      instructions: "Base instructions.",
      tools: [kit],
    });

    expect(agent.getTool("alpha")).toBeDefined();
    expect(agent.instructions).toBe("Base instructions.\n\nAlways call alpha before answering.");

    const outcome = await agent.generate({ prompt: "go" });
    expect(outcome.type).toBe("response");

    if (outcome.type === "response") {
      expect(outcome.output).toBe("finished");
    }

    expect(seenRequest?.tools.map((t) => t.name)).toEqual(["alpha"]);

    expect(
      () =>
        new Agent({
          id: "collision-agent",
          model,
          tools: [kit, alpha],
        }),
    ).toThrow(/Duplicate/);
  });

  it("works seamlessly with embedTools and createToolIndex and rejects malformed toolkits", async () => {
    const kit = createToolkit({ name: "indexed", tools: [alpha, beta] });
    const embedded = await embedTools({
      model: createFakeEmbeddingModel(),
      tools: [kit],
    });
    expect(embedded.documents.map((d) => d.id)).toEqual(["alpha", "beta"]);

    const index = await createToolIndex({
      model: createFakeEmbeddingModel(),
      tools: [kit],
      topK: 1,
    });

    expect(index.tools.map((t) => t.name)).toEqual(["alpha", "beta"]);
    const hits = await index.search({ query: "alpha" });
    expect(hits[0]?.document.toolName).toBe("alpha");

    await expect(
      embedTools({
        model: createFakeEmbeddingModel(),
        tools: [{ kind: "toolkit", name: "", tools: [] } as unknown as typeof alpha],
      }),
    ).rejects.toThrow(/Invalid toolkit/);
  });
});

describe("Agent lifecycle array support", () => {
  it("keeps unregistered hooks undefined and returns undefined for empty arrays", () => {
    expect(normalizeAgentLifecycle([])).toBeUndefined();
    expect(normalizeAgentLifecycle([{}, {}])).toBeUndefined();

    const composed = normalizeAgentLifecycle([{ onStart: () => {} }, { onFinish: () => {} }]);
    expect(composed?.onStart).toBeTypeOf("function");
    expect(composed?.onFinish).toBeTypeOf("function");
    expect(composed?.onStepFinish).toBeUndefined();
    expect(composed?.onToolStart).toBeUndefined();
    expect(composed?.onToolFinish).toBeUndefined();
    expect(composed?.onError).toBeUndefined();
  });

  it("composes lifecycle arrays on AgentOptions and per-run settings in order", async () => {
    const order: string[] = [];
    const hookA: AgentLifecycle = {
      onStart: () => {
        order.push("agent:a:start");
      },
      onFinish: () => {
        order.push("agent:a:finish");
      },
    };
    const hookB: AgentLifecycle = {
      onStart: () => {
        order.push("agent:b:start");
      },
      onFinish: () => {
        order.push("agent:b:finish");
      },
    };
    const runHookC: AgentLifecycle = {
      onStart: () => {
        order.push("run:c:start");
      },
    };
    const runHookD: AgentLifecycle = {
      onStart: vi.fn(() => {
        order.push("run:d:start");
      }),
    };

    const model = createFakeModel(() => ({
      choice: [{ type: "text", text: "hi" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));

    const agent = new Agent({
      id: "lifecycle-array-agent",
      model,
      lifecycle: [hookA, hookB],
    });

    const outcome = await agent.generate({
      prompt: "hello",
      lifecycle: [runHookC, runHookD],
    });

    expect(outcome.type).toBe("response");
    expect(order).toEqual([
      "agent:a:start",
      "agent:b:start",
      "run:c:start",
      "run:d:start",
      "agent:a:finish",
      "agent:b:finish",
    ]);
  });
});
