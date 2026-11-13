import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, ProviderTool } from "@anvia/core/completion";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, hasToolResult, lookup, response, toolResponse } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-provider-tools-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

const webSearch = (configuration?: ProviderTool["configuration"]): ProviderTool => {
  const tool: ProviderTool = { kind: "provider", provider: "openai", name: "web_search" };
  if (configuration !== undefined) tool.configuration = configuration;
  return tool;
};

function agentWith(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  providerTool: ProviderTool,
): Agent<unknown> {
  return new Agent<unknown>({
    id: "searching",
    tools: [lookup(async () => "found"), providerTool],
    model: {
      provider: "test",
      modelId: "test",
      // The model must declare provider-tool support, or core rejects the request.
      capabilities: { ...capabilities, providerTools: true },
      completion: (request) => completion(request),
    },
  });
}

async function open(
  path: string,
  agent: Agent<unknown>,
  options: Partial<DurableAgentRegistration> = {},
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", providerTools: { mode: "stateless" }, ...options }],
  });
  runtimes.push(runtime);
  return runtime;
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

/** The stored record of one model operation, as the journal holds it. */
function storedModelRecord(path: string, runId: string, turn: number): string {
  const db = new DatabaseSync(path);
  const row = db
    .prepare("SELECT record FROM anvia_durable_operations WHERE run_id = ? AND key LIKE ?")
    .get(runId, `%:model:${turn}`) as { record: string } | undefined;
  db.close();
  return row?.record ?? "";
}

/** A tool-call turn in which the provider also ran its own search. */
function searchingTurn() {
  return {
    ...toolResponse(),
    providerToolCalls: [
      { id: "ws_1", name: "web_search", status: "completed", details: { query: "anvia" } },
    ],
  };
}

const submission = { agentId: "searching", sessionId: "session", requestId: "one" };
const stateless = { providerTools: { mode: "stateless" as const } };

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("registration of provider tools", () => {
  it("accepts provider tools with the stateless marker", async () => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent: agentWith(async () => done(), webSearch()), version: "1", ...stateless }],
      }),
    ).resolves.toBeDefined();
  });

  it("rejects provider tools without the marker and names the marker", async () => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent: agentWith(async () => done(), webSearch()), version: "1" }],
      }),
    ).rejects.toThrow(/provider tools.*\{ providerTools: \{ mode: "stateless" \} \}/);
  });

  it("rejects a provider tool whose configuration is not JSON, naming the tool", () => {
    const notJson = webSearch({ filter: undefined as never, sizes: [1n as never] } as never);
    // Core rejects the tool when the Agent is built, before durable registration sees it.
    expect(() => agentWith(async () => done(), notJson)).toThrow(
      /Provider tool "web_search" is invalid.*configuration must be a JSON object/,
    );
  });

  it("rejects an unknown providerTools mode", async () => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [
          {
            agent: agentWith(async () => done(), webSearch()),
            version: "1",
            providerTools: { mode: "hosted" } as never,
          },
        ],
      }),
    ).rejects.toThrow(/unknown providerTools mode/);
  });
});

describe("provider tools replay", () => {
  itSqlite(
    "reuses the persisted provider response after a restart instead of asking again",
    async () => {
      const path = database();
      const first = vi.fn(async (request: CompletionRequest) => {
        if (!hasToolResult(request)) return searchingTurn();
        throw new Error("provider down");
      });
      const runtime = await open(path, agentWith(first, webSearch({ searchContextSize: "low" })));
      const submitted = await runtime.submit({ ...submission, prompt: "hello" });
      expect((await settled(submitted)).run.status).toBe("failed");
      expect(first).toHaveBeenCalledTimes(2);
      // The provider's own tool call is part of the persisted response for turn 1.
      expect(storedModelRecord(path, submitted.id, 1)).toContain("ws_1");
      await runtime.close();
      runtimes.splice(runtimes.indexOf(runtime), 1);

      const second = vi.fn(async (_request: CompletionRequest) => done());
      const reopened = await open(path, agentWith(second, webSearch({ searchContextSize: "low" })));
      await (await reopened.getRun(submitted.id)).retry();
      expect((await settled(await reopened.getRun(submitted.id))).run.status).toBe("completed");

      // Turn 1 was restored from the journal; only the second model turn ran again.
      expect(second).toHaveBeenCalledTimes(1);
      expect(hasToolResult(second.mock.calls[0]![0])).toBe(true);
    },
  );

  it("fails replay when a provider tool definition changed under the same version", async () => {
    const path = database();
    const first = vi.fn(async (request: CompletionRequest) => {
      if (!hasToolResult(request)) return searchingTurn();
      throw new Error("provider down");
    });
    const runtime = await open(path, agentWith(first, webSearch({ searchContextSize: "low" })));
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(path, agentWith(second, webSearch({ searchContextSize: "high" })));
    await (await reopened.getRun(submitted.id)).retry();
    const snapshot = await settled(await reopened.getRun(submitted.id));
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.run.error).toContain("Execution changed at a saved checkpoint");
    expect(second).not.toHaveBeenCalled();
  });

  it("sends the provider tool definition with every model request", async () => {
    const model = vi.fn(async (_request: CompletionRequest) =>
      response([{ type: "text", text: "ok" }]),
    );
    const runtime = await open(database(), agentWith(model, webSearch()));
    await (await runtime.submit({ ...submission, prompt: "hello" })).result();
    expect(model.mock.calls[0]![0].providerTools).toContainEqual(
      expect.objectContaining({ kind: "provider", name: "web_search" }),
    );
  });
});
