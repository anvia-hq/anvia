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
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  type McpServer,
  type McpTool,
  Usage,
  withInternalAgentRunOptions,
} from "./helpers/imports";
import { createResolvedAgent, getResolvedAgentOptions } from "../src/agent/resolved-agent";
import { getAssistantGenerationMetadata, type StreamingCompletionModel } from "../src/completion";
import type { AgentRunExecution } from "../src/internal/agent-runtime/execution";
import { loadSkills, type Skill } from "../src/skills";

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
    outputSchema: true,
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

  it("scales to the final attempt's input tokens, not the cumulative retry usage", async () => {
    const trace = recorder();
    const replies = [response("not json", usage(3_000)), response('{"ok":true}', usage(3_000))];
    const agent = new Agent({
      id: "context-agent",
      model: new FixedModel(() => replies.shift() ?? response('{"ok":true}', usage(3_000))),
      instructions: "You are a careful assistant.",
      outputSchema: z.object({ ok: z.boolean() }),
      retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      observability: { observers: { test: trace.observer } },
    });

    await agent.generate({ prompt: "hello" });

    const end = trace.ends[0];
    expect(end?.response.usage.inputTokens).toBe(6_000);
    expect(end?.context?.reportedInputTokens).toBe(3_000);
  });

  it("tracks skills (catalog, tools, loaded outputs) and exposes contextBreakdown on outcomes and streams", async () => {
    const demoSkill: Skill = {
      name: "deploy",
      description: "Deploy services safely.",
      instructions: "# Deploy Guide\n".repeat(40),
      directory: "/tmp/skills/deploy",
      references: [],
      scripts: [],
    };
    const skillSet = await loadSkills({ load: async () => [demoSkill] });

    let turn = 0;
    const outboundRequests: CompletionRequest[] = [];
    const streamingModel: StreamingCompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: {
        streaming: true,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: true,
        reasoning: false,
      },
      async completion() {
        return response("done", usage(2_000));
      },
      async *streamCompletion(request): AsyncIterable<CompletionModelStreamEvent> {
        outboundRequests.push(request);
        turn += 1;

        if (turn === 1) {
          yield {
            type: "final",
            response: {
              choice: [
                {
                  type: "tool-call",
                  toolCallId: "call-skill-1",
                  toolName: "get_skill_instructions",
                  input: { skillName: "deploy" },
                },
                {
                  type: "tool-call",
                  toolCallId: "call-local-1",
                  toolName: "local_lookup",
                  input: { id: "42" },
                },
              ],
              usage: usage(1_000),
              rawResponse: {},
            },
          };
          return;
        }

        yield { type: "text_delta", delta: "Deployed." };
        yield { type: "final", response: response("Deployed.", usage(2_500)) };
      },
    };

    const trace = recorder();
    const original = new Agent({
      id: "skills-context-agent",
      model: streamingModel,
      instructions: "You are a careful assistant.",
      skills: skillSet,
      tools: [localTool],
      mcpServers: [mcpServer()],
      observability: { observers: { test: trace.observer } },
    });
    const agent = createResolvedAgent(getResolvedAgentOptions(original));

    const stream = agent.stream({ prompt: "deploy now" });
    const turnEnds: Array<{
      turn: number;
      segmentIds: string[];
      reported: number | undefined;
    }> = [];
    for await (const event of stream) {
      if (event.type === "turn_end") {
        turnEnds.push({
          turn: event.turn,
          segmentIds: event.contextBreakdown?.segments.map((s) => s.id) ?? [],
          reported: event.contextBreakdown?.reportedInputTokens,
        });
      }
    }
    const outcome = await stream.result;

    expect(turnEnds).toEqual([
      {
        turn: 1,
        segmentIds: ["instructions", "skills", "messages", "tools", "mcpTools"],
        reported: 1_000,
      },
      {
        turn: 2,
        segmentIds: ["instructions", "skills", "messages", "toolResults", "tools", "mcpTools"],
        reported: 2_500,
      },
    ]);

    const turn1Skills = trace.starts[0]?.context?.segments.find((s) => s.id === "skills");
    const turn2Skills = trace.starts[1]?.context?.segments.find((s) => s.id === "skills");
    expect(turn1Skills?.items).toBe(5);
    expect(turn2Skills?.items).toBe(6);
    expect(turn2Skills?.characters).toBeGreaterThan(turn1Skills?.characters ?? 0);

    expect(outcome.contextBreakdown?.reportedInputTokens).toBe(2_500);
    expect(outcome.contextBreakdown?.segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(2_500);
    expect(outcome.contextBreakdown?.segments.some((s) => s.id === "skills")).toBe(true);
    expect(outcome.contextBreakdown?.segments.some((s) => s.id === "mcpTools")).toBe(true);

    const turn2OutboundAssistant = outboundRequests[1]?.chatHistory.find(
      (message) => message.role === "assistant",
    );
    expect(
      turn2OutboundAssistant && getAssistantGenerationMetadata(turn2OutboundAssistant),
    ).not.toHaveProperty("contextBreakdown");
    const outcomeAssistantReported = outcome.messages
      .filter((message) => message.role === "assistant")
      .map(
        (message) => getAssistantGenerationMetadata(message)?.contextBreakdown?.reportedInputTokens,
      );
    expect(outcomeAssistantReported).toEqual([1_000, 2_500]);
  });

  it("scales contextBreakdown for replayed non-streaming model turns", async () => {
    const agent = new Agent({
      id: "replay-context-agent",
      model: new FixedModel(() => {
        throw new Error("should not call model on replay");
      }),
      instructions: "You are a careful assistant.",
      tools: [localTool],
    });
    const execution: AgentRunExecution = {
      replayed: (step) => step.kind === "model",
      completion: async () => response("replayed", usage(4_200)),
      tool: async () => {
        throw new Error("should not call tools on replay");
      },
    };

    const outcome = await agent.generate(
      withInternalAgentRunOptions({ prompt: "look up record 1" }, { execution }),
    );

    expect(outcome.type).toBe("response");
    expect(outcome.contextBreakdown?.reportedInputTokens).toBe(4_200);
    expect(outcome.contextBreakdown?.estimatedTokens).toBe(4_200);
    expect(outcome.contextBreakdown?.segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(4_200);
  });
});
