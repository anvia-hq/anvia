import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  AssistantContent,
  createTool,
  Usage,
  withInternalAgentRunOptions,
  type CompletionModel,
  type CompletionResponse,
} from "./helpers/imports";
import type { AgentRunExecution } from "../src/internal/agent-runtime/execution";

function agentWithTool(execute: () => string) {
  let turn = 0;
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
    completion: vi.fn(async (): Promise<CompletionResponse> => ({
      choice:
        turn++ === 0
          ? [AssistantContent.toolCall("call", "write", {})]
          : [AssistantContent.text("done")],
      usage: Usage.empty(),
      rawResponse: {},
    })),
  };
  return new Agent({
    id: "agent",
    model,
    tools: [
      createTool({ name: "write", description: "write", inputSchema: z.object({}), execute }),
    ],
  });
}

it("propagates checkpoint failures without running the tool or asking the model to continue", async () => {
  const tool = vi.fn(() => "written");
  const agent = agentWithTool(tool);
  const failure = new Error("storage unavailable");
  const execution: AgentRunExecution = {
    completion: (_turn, _request, execute) => execute(),
    tool: async () => {
      throw failure;
    },
  };
  await expect(
    agent.generate(withInternalAgentRunOptions({ prompt: "write" }, { execution })),
  ).rejects.toBe(failure);
  expect(tool).not.toHaveBeenCalled();
  expect(agent.model.completion).toHaveBeenCalledTimes(1);
});

it("reuses a saved normalized tool result without executing its callback", async () => {
  const tool = vi.fn(() => "written");
  const agent = agentWithTool(tool);
  const execution: AgentRunExecution = {
    completion: (_turn, _request, execute) => execute(),
    tool: async () => ({ failed: false, output: { type: "text", value: "saved" } }),
  };
  const outcome = await agent.generate(
    withInternalAgentRunOptions({ prompt: "write" }, { execution }),
  );
  expect(outcome).toMatchObject({ type: "response", output: "done" });
  expect(tool).not.toHaveBeenCalled();
  expect(JSON.stringify(outcome.messages)).toContain("saved");
});

function streamingAgentWithTool(execute: () => string) {
  const original = agentWithTool(execute);
  const streamCompletion = vi.fn(async function* () {
    yield { type: "text_delta" as const, delta: "done" };
    yield {
      type: "final" as const,
      response: { choice: [AssistantContent.text("done")], usage: Usage.empty(), rawResponse: {} },
    };
  });
  const agent = new Agent({
    id: original.id,
    tools: original.tools,
    model: {
      ...original.model,
      capabilities: { ...original.model.capabilities, streaming: true },
      streamCompletion,
    },
  });
  return { agent, streamCompletion };
}

it("restores streamed completion and tool checkpoints without calling their callbacks", async () => {
  const tool = vi.fn(() => "written");
  const { agent, streamCompletion } = streamingAgentWithTool(tool);
  const streamBoundary = vi.fn(async function* (turn: number) {
    yield* [];
    return {
      choice:
        turn === 1
          ? [AssistantContent.toolCall("call", "write", {})]
          : [AssistantContent.text("saved")],
      usage: Usage.empty(),
      rawResponse: null,
    };
  });
  const execution: AgentRunExecution = {
    completion: async () => {
      throw new Error("Unexpected generate boundary");
    },
    streamCompletion: streamBoundary,
    tool: async () => ({ failed: false, output: { type: "text", value: "saved tool" } }),
  };
  const outcome = await agent.stream(
    withInternalAgentRunOptions({ prompt: "write" }, { execution }),
  ).result;
  expect(outcome).toMatchObject({ output: "saved" });
  expect(streamBoundary).toHaveBeenCalledTimes(2);
  expect(streamCompletion).not.toHaveBeenCalled();
  expect(tool).not.toHaveBeenCalled();
  expect(JSON.stringify(outcome.messages)).toContain("saved tool");
});

it("does not bypass persistence when an execution runtime lacks streaming support", async () => {
  const { agent, streamCompletion } = streamingAgentWithTool(() => "written");
  const execution: AgentRunExecution = {
    completion: (_turn, _request, execute) => execute(),
    tool: (_call, execute) => execute(),
  };
  await expect(
    agent.stream(withInternalAgentRunOptions({ prompt: "write" }, { execution })).result,
  ).rejects.toThrow("does not support streaming checkpoints");
  expect(streamCompletion).not.toHaveBeenCalled();
});

it("passes validated streamed responses through the checkpoint boundary", async () => {
  const { agent } = streamingAgentWithTool(() => "written");
  let saved: CompletionResponse | undefined;
  const deltas: string[] = [];
  const execution: AgentRunExecution = {
    completion: (_turn, _request, execute) => execute(),
    async *streamCompletion(_turn, _request, execute) {
      const stream = execute();
      while (true) {
        const next = await stream.next();
        if (next.done) {
          saved = next.value;
          return next.value;
        }
        if (next.value.type === "text_delta") deltas.push(next.value.delta);
        yield next.value;
      }
    },
    tool: (_call, execute) => execute(),
  };
  const outcome = await agent.stream(
    withInternalAgentRunOptions({ prompt: "write" }, { execution }),
  ).result;
  expect(outcome).toMatchObject({ output: "done" });
  expect(deltas).toEqual(["done"]);
  expect(saved?.choice).toEqual([AssistantContent.text("done")]);
});
