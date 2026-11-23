import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../src/agent";
import {
  Usage,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type StreamingCompletionModel,
} from "../src/completion";
import { withInternalAgentRunOptions } from "../src/internal/agent";
import type {
  AgentGenerationErrorArgs,
  AgentGenerationStartArgs,
  AgentObserver,
  AgentRunEventArgs,
  AgentToolStartArgs,
} from "../src/observability";
import { createTool, type AnyTool, type ToolIndex } from "../src/tool";

class ParityModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "parity";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };

  constructor(
    private readonly responses: Array<
      { kind: "ok"; response: CompletionResponse } | { kind: "stream-error"; error: Error }
    >,
  ) {}

  async completion(_request: CompletionRequest): Promise<CompletionResponse> {
    const next = this.responses.shift();

    if (next === undefined) {
      throw new Error("No queued response");
    }

    if (next.kind === "stream-error") {
      throw next.error;
    }

    return next.response;
  }

  async *streamCompletion(_request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    const next = this.responses.shift();

    if (next === undefined) {
      throw new Error("No queued response");
    }

    if (next.kind === "stream-error") {
      throw next.error;
    }

    yield { type: "final", response: next.response };
  }
}

function createRecordingObserver() {
  const generationStarts: AgentGenerationStartArgs[] = [];
  const generationErrors: AgentGenerationErrorArgs[] = [];
  const toolStarts: AgentToolStartArgs[] = [];
  const runEvents: AgentRunEventArgs[] = [];
  const observer: AgentObserver = {
    startRun: () => ({
      startGeneration: (args) => {
        generationStarts.push(args);
        return {
          end: () => {},
          error: (errorArgs) => {
            generationErrors.push(errorArgs);
          },
        };
      },
      startTool: (args) => {
        toolStarts.push(args);
        return {
          end: () => {},
          error: () => {},
        };
      },
      end: () => {},
      error: () => {},
      event: (args) => {
        runEvents.push(args);
      },
    }),
  };

  return { observer, generationStarts, generationErrors, toolStarts, runEvents };
}

function createIndexTool(name: string): AnyTool {
  return {
    name,
    definition: () => ({
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
    }),
    call: async () => "ok",
  };
}

describe("agent observability and replay parity", () => {
  it("reports toolMatches to generation observers in generate()", async () => {
    const index: ToolIndex = {
      kind: "tool-index",
      tools: [createIndexTool("issue_refund")],
      topK: 1,
      search: async () => [
        {
          id: "issue_refund",
          score: 0.92,
          document: {
            toolName: "issue_refund",
            definition: {
              name: "issue_refund",
              description: "issue_refund tool",
              parameters: { type: "object", properties: {} },
            },
            text: "issue_refund",
          },
        },
      ],
    };
    const recorded = createRecordingObserver();
    const model = new ParityModel([
      {
        kind: "ok",
        response: {
          choice: [{ type: "text", text: "done" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ]);
    const agent = new Agent({
      id: "parity-tools",
      model,
      tools: [index],
      observability: { observers: { recorder: recorded.observer } },
    });

    await agent.generate({ prompt: "refund order" });

    expect(recorded.generationStarts).toHaveLength(1);
    expect(recorded.generationStarts[0]?.toolMatches).toEqual([
      { toolName: "issue_refund", index: 0, score: 0.92 },
    ]);
  });

  it("emits agent.interaction_response observer event in stream() continuation runs", async () => {
    const recorded = createRecordingObserver();
    const approveTool = createTool({
      name: "delete_item",
      description: "Delete item",
      inputSchema: z.object({ id: z.string() }),
      requiresApproval: true,
      handler: () => "deleted",
    });
    const model = new ParityModel([
      {
        kind: "ok",
        response: {
          choice: [
            {
              type: "tool-call",
              toolCallId: "tc_1",
              toolName: "delete_item",
              input: { id: "42" },
            },
          ],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
      {
        kind: "ok",
        response: {
          choice: [{ type: "text", text: "deleted" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ]);
    const agent = new Agent({
      id: "parity-interaction",
      model,
      tools: [approveTool],
      observability: { observers: { recorder: recorded.observer } },
    });

    const suspended = await agent.generate({ prompt: "delete 42" });
    expect(suspended.type).toBe("interaction");

    if (suspended.type !== "interaction") {
      throw new Error("Expected interaction outcome");
    }

    recorded.runEvents.length = 0;

    for await (const _event of agent.stream({
      continuation: suspended.continuation,
      response: { type: "tool-approval", approved: true },
    })) {
      void _event;
    }

    expect(recorded.runEvents).toContainEqual({
      name: "agent.interaction_response",
      attributes: {
        sourceRunId: suspended.runId,
        interactionId: suspended.interaction.id,
        interactionType: "tool-approval",
      },
    });
  });

  it("emits agent.steering_applied observer event in stream() before finish", async () => {
    const recorded = createRecordingObserver();
    const model = new ParityModel([
      {
        kind: "ok",
        response: {
          choice: [{ type: "text", text: "first" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
      {
        kind: "ok",
        response: {
          choice: [{ type: "text", text: "second" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ]);
    const agent = new Agent({
      id: "parity-steering",
      model,
      observability: { observers: { recorder: recorded.observer } },
    });

    const stream = agent.stream({ prompt: "start" });
    let receiptId: string | undefined;

    for await (const event of stream) {
      if (event.type === "turn_end" && event.turn === 1) {
        receiptId = stream.steer({ prompt: "keep going" }).id;
      }
    }

    expect(receiptId).toBeDefined();
    expect(recorded.runEvents).toContainEqual({
      name: "agent.steering_applied",
      attributes: { id: receiptId, turn: 1 },
    });
  });

  it("attaches estimated context breakdown to generation error events in stream()", async () => {
    const recorded = createRecordingObserver();
    const model = new ParityModel([{ kind: "stream-error", error: new Error("stream boom") }]);
    const agent = new Agent({
      id: "parity-context",
      model,
      instructions: "Be concise.",
      observability: { observers: { recorder: recorded.observer } },
    });

    for await (const _event of agent.stream({ prompt: "hello" })) {
      void _event;
    }

    expect(recorded.generationErrors).toHaveLength(1);
    expect(recorded.generationErrors[0]?.context).toBeDefined();
    expect(recorded.generationErrors[0]?.context?.estimatedTokens).toBeGreaterThan(0);
  });

  it("skips duplicate tool observation when a resumed denied tool is replayed", async () => {
    const recorded = createRecordingObserver();
    const approveTool = createTool({
      name: "delete_item",
      description: "Delete item",
      inputSchema: z.object({ id: z.string() }),
      requiresApproval: true,
      handler: () => "deleted",
    });
    const model = new ParityModel([
      {
        kind: "ok",
        response: {
          choice: [
            {
              type: "tool-call",
              toolCallId: "tc_1",
              toolName: "delete_item",
              input: { id: "42" },
            },
          ],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
      {
        kind: "ok",
        response: {
          choice: [{ type: "text", text: "cancelled" }],
          usage: Usage.empty(),
          rawResponse: {},
        },
      },
    ]);
    const agent = new Agent({
      id: "parity-replay",
      model,
      tools: [approveTool],
      observability: { observers: { recorder: recorded.observer } },
    });

    const suspended = await agent.generate({ prompt: "delete 42" });
    expect(suspended.type).toBe("interaction");

    if (suspended.type !== "interaction") {
      throw new Error("Expected interaction outcome");
    }

    recorded.toolStarts.length = 0;
    const replayed = vi.fn((step: { kind: string }) => step.kind === "tool");

    await agent.generate(
      withInternalAgentRunOptions(
        {
          continuation: suspended.continuation,
          response: { type: "tool-approval", approved: false, reason: "no" },
        },
        {
          execution: {
            completion: (_turn, _request, run) => run(),
            tool: (_call, run) => run(),
            replayed,
          },
        },
      ),
    );

    expect(replayed).toHaveBeenCalled();
    expect(recorded.toolStarts).toHaveLength(0);
  });
});
