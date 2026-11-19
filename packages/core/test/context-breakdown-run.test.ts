import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  type AgentGenerationEndArgs,
  type AgentGenerationErrorArgs,
  type AgentGenerationStartArgs,
  type AgentObserver,
  type AgentRunObserver,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  type McpServer,
  type McpTool,
  Usage,
} from "./helpers/imports";

function response(text: string, usage: Usage): CompletionResponse {
  return {
    choice: [{ type: "text", text }],
    usage,
    rawResponse: {},
  };
}

class FixedModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };

  constructor(private readonly result: (request: CompletionRequest) => CompletionResponse) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    return this.result(request);
  }
}

function recorder(): {
  observer: AgentObserver;
  starts: AgentGenerationStartArgs[];
  ends: AgentGenerationEndArgs[];
  errors: AgentGenerationErrorArgs[];
} {
  const starts: AgentGenerationStartArgs[] = [];
  const ends: AgentGenerationEndArgs[] = [];
  const errors: AgentGenerationErrorArgs[] = [];
  return {
    starts,
    ends,
    errors,
    observer: {
      startRun(): AgentRunObserver {
        return {
          startGeneration(args) {
            starts.push(args);
            return {
              end(args) {
                ends.push(args);
              },
              error(args) {
                errors.push(args);
              },
            };
          },
          end() {},
        };
      },
    },
  };
}

function mcpServer(): McpServer {
  const base = createTool({
    name: "mcp_lookup",
    description: "Look up a record from a remote MCP server",
    inputSchema: z.object({ id: z.string() }),
    execute: () => "found",
  });
  const tool: McpTool = Object.freeze({
    ...base,
    mcp: Object.freeze({ serverName: "records", remoteName: "lookup" }),
  });
  return Object.freeze({ name: "records", tools: Object.freeze([tool]) });
}

const localTool = createTool({
  name: "local_lookup",
  description: "Look up a local record",
  inputSchema: z.object({ id: z.string() }),
  execute: () => "found",
});

const usage = (inputTokens: number): Usage => ({
  ...Usage.empty(),
  inputTokens,
  outputTokens: 5,
  totalTokens: inputTokens + 5,
});

describe("agent generation context breakdown", () => {
  it("reports the request split with MCP tools in their own segment", async () => {
    const trace = recorder();
    const agent = new Agent({
      id: "context-agent",
      model: new FixedModel(() => response("ok", usage(4_000))),
      instructions: "You are a careful assistant.",
      tools: [localTool],
      mcpServers: [mcpServer()],
      observability: { observers: { test: trace.observer } },
    });

    await agent.generate({ prompt: "look up record 1" });

    const start = trace.starts[0];
    expect(start?.context?.reportedInputTokens).toBeUndefined();
    expect(start?.context?.segments.map((segment) => segment.id)).toEqual([
      "instructions",
      "messages",
      "tools",
      "mcpTools",
    ]);
    expect(start?.context?.segments.find((segment) => segment.id === "mcpTools")?.items).toBe(1);
  });

  it("scales the split so its segments add up to the reported input tokens", async () => {
    const trace = recorder();
    const agent = new Agent({
      id: "context-agent",
      model: new FixedModel(() => response("ok", usage(4_000))),
      instructions: "You are a careful assistant.",
      tools: [localTool],
      observability: { observers: { test: trace.observer } },
    });

    await agent.generate({ prompt: "look up record 1" });

    const context = trace.ends[0]?.context;
    expect(context?.reportedInputTokens).toBe(4_000);
    expect(context?.estimatedTokens).toBe(4_000);
    expect(context?.segments.reduce((total, segment) => total + segment.tokens, 0)).toBe(4_000);
  });

  it("reports the estimate when the generation fails before any usage exists", async () => {
    const trace = recorder();
    const agent = new Agent({
      id: "context-agent",
      model: new FixedModel(() => {
        throw new Error("provider down");
      }),
      instructions: "You are a careful assistant.",
      observability: { observers: { test: trace.observer } },
    });

    await expect(agent.generate({ prompt: "hello" })).rejects.toThrow("provider down");

    const context = trace.errors[0]?.context;
    expect(context?.reportedInputTokens).toBeUndefined();
    expect(context?.segments.map((segment) => segment.id)).toEqual(["instructions", "messages"]);
  });
});
