import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import type { Embedding, EmbeddingModel } from "@anvia/core/embeddings";
import { createTool, createToolIndex } from "@anvia/core/tool";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done } from "./helpers.js";

const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

class FixedEmbeddingModel implements EmbeddingModel {
  constructor(
    readonly modelId: string,
    readonly provider = "test",
  ) {}

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({ document, vector: [1, 0] }));
  }
}

const recallTool = createTool({
  name: "recall",
  description: "Recall saved notes.",
  inputSchema: z.object({ query: z.string().optional() }),
  handler: () => "notes",
});

async function agentWith(
  model: EmbeddingModel,
  content?: (tool: unknown) => string,
): Promise<Agent> {
  const options: Parameters<typeof createToolIndex>[0] = {
    model,
    tools: [recallTool as never],
    topK: 1,
  };
  if (content !== undefined) options.content = content as never;
  const index = await createToolIndex(options);
  return new Agent({
    id: "researcher",
    tools: [index],
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: async (_request: CompletionRequest) => done(),
    },
  });
}

function registration(agent: Agent): DurableAgentRegistration {
  return { agent, version: "1", toolIndexes: { mode: "recorded" } };
}

async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

async function hashOf(agent: Agent): Promise<string> {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [registration(agent)],
  });
  runtimes.push(runtime);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "s",
    requestId: "r",
    prompt: "notes",
  });
  const snapshot = await settled(run);
  expect(snapshot.run.status).toBe("completed");
  return snapshot.run.toolIndexes!.hash;
}

it("changes the fingerprint when the embedding model changes", async () => {
  const first = await hashOf(await agentWith(new FixedEmbeddingModel("small")));
  const same = await hashOf(await agentWith(new FixedEmbeddingModel("small")));
  const other = await hashOf(await agentWith(new FixedEmbeddingModel("large")));

  expect(same).toBe(first);
  expect(other).not.toBe(first);
});

it("changes the fingerprint when the embedded text changes", async () => {
  const model = new FixedEmbeddingModel("small");
  const first = await hashOf(await agentWith(model, () => "recall"));
  const second = await hashOf(await agentWith(model, () => "recall saved notes only"));

  expect(second).not.toBe(first);
});

it("keeps structurally supplied indexes interchangeable", async () => {
  const structural = (): Agent =>
    new Agent({
      id: "researcher",
      tools: [
        {
          kind: "tool-index",
          tools: [
            {
              name: "recall",
              definition: () => ({
                name: "recall",
                description: "Recall saved notes.",
                parameters: { type: "object", properties: {} },
              }),
              call: async () => "notes",
            },
          ],
          topK: 1,
          search: vi.fn(async () => []),
        },
      ],
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async () => done(),
      },
    });

  expect(await hashOf(structural())).toBe(await hashOf(structural()));
});
