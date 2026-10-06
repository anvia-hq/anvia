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
