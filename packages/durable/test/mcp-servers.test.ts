import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, ToolDefinition } from "@anvia/core/completion";
import type { McpServer, McpTool } from "@anvia/core/mcp";
import type { ToolCallContext } from "@anvia/core/tool";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, hasToolResult, response } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-mcp-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function searchDefinition(description = "Search the docs"): ToolDefinition {
  return {
    name: "search",
    description,
    parameters: { type: "object", properties: { query: { type: "string" } } },
  };
}

/** A tool as `McpClient.connect()` returns it: the definition is copied at discovery. */
function mcpTool(call: McpTool["call"], description?: string): McpTool {
  return {
    name: "search",
    mcp: { serverName: "docs", remoteName: "search" },
    definition: () => searchDefinition(description),
    call,
  };
}

function docsServer(tool: McpTool, extra: McpTool[] = []): McpServer {
  return {
    name: "docs",
    tools: [tool, ...extra],
    serverInfo: { name: "docs", version: "1.0.0" },
  };
}

function mcpAgent(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  server: McpServer,
) {
  return new Agent({
    id: "researcher",
    mcpServers: [server],
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  });
}

/** Turn one asks for the MCP tool; turn two answers once the tool result is in the request. */
const askForSearch = () =>
  response([{ type: "tool-call", toolCallId: "call-1", toolName: "search", input: {} }]);

function registration(agent: Agent, marker = true): DurableAgentRegistration {
  return marker ? { agent, version: "1", mcpServers: { mode: "pinned" } } : { agent, version: "1" };
}

async function open(path: string, agent: Agent) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [registration(agent)],
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

const submission = { agentId: "researcher", sessionId: "session", requestId: "one" };

it("rejects MCP servers without the marker and names it", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const server = docsServer(mcpTool(async () => "result"));
  expect(() =>
    runtime.registerAgents([
      registration(
        mcpAgent(async () => done(), server),
        false,
      ),
    ]),
  ).toThrow(/MCP servers need \{ mcpServers: \{ mode: "pinned" \} \}/);
  expect(runtime.compatibility()).toEqual([]);
});

it("rejects an unknown mcpServers mode", async () => {
  const runtime = await DurableRuntime.open({ store: new SqliteDurableStore(":memory:") });
  runtimes.push(runtime);
  const server = docsServer(mcpTool(async () => "result"));
  expect(() =>
    runtime.registerAgents([
      {
        agent: mcpAgent(async () => done(), server),
        version: "1",
        mcpServers: { mode: "live" } as unknown as { mode: "pinned" },
      },
    ]),
  ).toThrow(/unknown mcpServers mode/);
});

it("offers the pinned tools to the model and records the fingerprint with the run", async () => {
  const call = vi.fn(async (_args: unknown, _context?: ToolCallContext) => "docs found");
  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : askForSearch(),
  );
  const runtime = await open(database(), mcpAgent(model, docsServer(mcpTool(call))));
  const run = await runtime.submit({ ...submission, prompt: "find the docs" });
  expect((await run.result()).type).toBe("response");

  expect(model.mock.calls[0]![0].tools?.map((tool) => tool.name)).toEqual(["search"]);
  expect(call).toHaveBeenCalledTimes(1);
  const snapshot = await run.snapshot();
  expect(snapshot.run.mcpServers?.hash).toMatch(/^[a-f0-9]{64}$/);
});

it("reuses completed calls after a restart and does not call the tool again", async () => {
  const path = database();
  const call = vi.fn(async (_args: unknown, _context?: ToolCallContext) => "docs found");
  // The first attempt completes the MCP call, then the model fails on the next turn.
  const failing = vi.fn(async (request: CompletionRequest) => {
    if (hasToolResult(request)) throw new Error("provider down");
    return askForSearch();
  });
  const first = await open(path, mcpAgent(failing, docsServer(mcpTool(call))));
  const submitted = await first.submit({ ...submission, prompt: "find the docs" });
  expect((await settled(submitted)).run.status).toBe("failed");
  expect(call).toHaveBeenCalledTimes(1);
  await first.close();

  const model = vi.fn(async (request: CompletionRequest) =>
    hasToolResult(request) ? done() : askForSearch(),
  );
  const restarted = await open(path, mcpAgent(model, docsServer(mcpTool(call))));
  const run = await restarted.getRun(submitted.id);
  await run.retry();
  expect((await run.result()).type).toBe("response");
  expect(call).toHaveBeenCalledTimes(1);
});

it("blocks a retry whose server tool list changed under the same version", async () => {
  const path = database();
  const call = vi.fn(async (_args: unknown, _context?: ToolCallContext) => "docs found");
  const failing = vi.fn(async (request: CompletionRequest) => {
    if (hasToolResult(request)) throw new Error("provider down");
    return askForSearch();
  });
  const first = await open(path, mcpAgent(failing, docsServer(mcpTool(call))));
  const submitted = await first.submit({ ...submission, prompt: "find the docs" });
  expect((await settled(submitted)).run.status).toBe("failed");
  const recorded = (await submitted.snapshot()).run.mcpServers!.hash;
  await first.close();

  // The server now describes its search tool differently, under the same registration version.
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const changed = await open(
    path,
    mcpAgent(model, docsServer(mcpTool(call, "Search every page ever published"))),
  );
  const blocked = await changed.getRun(submitted.id);
  await blocked.retry();
  const snapshot = await settled(blocked);
  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.error).toContain("MCP servers changed");
  expect(snapshot.run.error).toContain(recorded.slice(0, 8));
  expect(model).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledTimes(1);
  await changed.close();

  // Restoring the original tool list unblocks the same run.
  const restored = await open(path, mcpAgent(model, docsServer(mcpTool(call))));
  const run = await restored.getRun(submitted.id);
  await run.retry();
  expect((await run.result()).type).toBe("response");
  expect(model).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(1);
});

it("blocks an uncertain MCP call for reconciliation after a restart", async () => {
  const path = database();
  let started!: () => void;
  const startedCall = new Promise<void>((resolve) => (started = resolve));
  // The call never answers; closing the runtime aborts it, so its outcome is unknown.
  const call = vi.fn(
    (_args: unknown, context?: ToolCallContext) =>
      new Promise<string>((_resolve, reject) => {
        started();
        context?.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const model = vi.fn(async (_request: CompletionRequest) => askForSearch());
  const first = await open(path, mcpAgent(model, docsServer(mcpTool(call))));
  const submitted = await first.submit({ ...submission, prompt: "find the docs" });
  await startedCall;
  await first.close();

  const next = vi.fn(async (_request: CompletionRequest) => done());
  const retried = await open(path, mcpAgent(next, docsServer(mcpTool(call))));
  // The run was in flight, not failed, so a restart resumes it rather than retrying it.
  await retried.resume();
  const run = await retried.getRun(submitted.id);
  const snapshot = await settled(run);
  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.blockedOperation).toBeDefined();
  // The call is not repeated and the model is not asked again until the outcome is reconciled.
  expect(call).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await run.resolveTool(snapshot.run.blockedOperation!, { type: "text", value: "reconciled" });
  expect((await run.result()).type).toBe("response");
  expect(call).toHaveBeenCalledTimes(1);
});
