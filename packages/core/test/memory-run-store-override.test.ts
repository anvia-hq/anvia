import { expect, it, vi } from "vitest";
import { InMemoryMemoryStore } from "../src/memory/in-memory-store";
import type { MemoryScope } from "../src/memory/types";
import {
  Agent,
  AssistantContent,
  Message,
  Usage,
  withInternalAgentRunOptions,
  type CompletionModel,
  type CompletionRequest,
} from "./helpers/imports";

const scope: MemoryScope = { sessionId: "thread-override" };

function agentWith(store: InMemoryMemoryStore, requests: CompletionRequest[]) {
  const model: CompletionModel = {
    provider: "test",
    modelId: "test",
    capabilities: {
      streaming: false,
      tools: false,
      toolChoice: false,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    completion: vi.fn(async (request: CompletionRequest) => {
      requests.push(request);
      return {
        choice: [AssistantContent.text("reply")],
        usage: Usage.empty(),
        rawResponse: {},
      };
    }),
  };
  return new Agent({ id: "agent", model, memory: { store, savePolicy: "run" } });
}

it("uses the per-run store and scope instead of the agent's store when internal options set them", async () => {
  const agentStore = new InMemoryMemoryStore();
  await agentStore.append({
    scope: { sessionId: "other" },
    runId: "earlier",
    turn: 1,
    messages: [Message.user("agent history")],
  });
  const runStore = new InMemoryMemoryStore();
  await runStore.append({
    scope,
    runId: "earlier",
    turn: 1,
    messages: [Message.user("run history")],
  });
  const requests: CompletionRequest[] = [];
  const agent = agentWith(agentStore, requests);

  await agent.generate(
    withInternalAgentRunOptions({ prompt: "hello" }, { memory: { store: runStore, scope } }),
  );

  const sent = JSON.stringify(requests[0]!.chatHistory);
  expect(sent).toContain("run history");
  expect(sent).not.toContain("agent history");
  expect(await runStore.load({ scope })).toHaveLength(3);
  expect(await agentStore.load({ scope: { sessionId: "other" } })).toHaveLength(1);
  expect(await agentStore.load({ scope })).toHaveLength(0);
});

it("keeps the agent's own store when no per-run override is given", async () => {
  const agentStore = new InMemoryMemoryStore();
  const requests: CompletionRequest[] = [];
  const agent = agentWith(agentStore, requests);
  await agent.generate({ prompt: "hello", session: scope });
  expect(await agentStore.load({ scope })).toHaveLength(2);
});
