import { Agent } from "@anvia/core/agent";
import { Usage, type CompletionResponse } from "@anvia/core/completion";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import type { AcpOptions, AcpSessionContext } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

let root: string;
const cleanup: Array<() => Promise<void>> = [];
const contexts: AcpSessionContext[] = [];
const capabilities = {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
};
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp-mcp-")));
  contexts.length = 0;
});
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
function server(name = "editor", mode = "normal") {
  return {
    type: "stdio" as const,
    name,
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url)),
      "literal; argument",
    ],
    env: [
      { name: "FIXTURE_LOG", value: join(root, `${name}.jsonl`) },
      { name: "FIXTURE_MODE", value: mode },
      { name: "FIXTURE_VALUE", value: "provided" },
    ],
  };
}
async function records(
  name = "editor",
): Promise<Array<{ event: string; pid: number; [key: string]: unknown }>> {
  try {
    return (await readFile(join(root, `${name}.jsonl`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
async function expectClosed(name = "editor") {
  const events = await records(name);
  const started = events
    .filter((entry) => entry.event === "start")
    .map((entry) => entry.pid)
    .sort();
  expect(started.length).toBeGreaterThan(0);
  expect(
    events
      .filter((entry) => entry.event === "exit")
      .map((entry) => entry.pid)
      .sort(),
  ).toEqual(started);
}
function binding(context: AcpSessionContext) {
  contexts.push(context);
  return {
    agent: new Agent({
      id: context.sessionId,
      model: makeAgent().model,
      mcpServers: context.mcpServers,
      retries: false,
    }),
  };
}
function manager(options: Partial<AcpOptions> = {}) {
  const result = new SessionManager({
    sessionFactory: binding,
    mcp: { stdio: true, authorizeServer: () => true },
    ...options,
  });
  cleanup.push(() => result.close());
  return result;
}
async function peer(options: Partial<AcpOptions> = {}) {
  const result = wireFixture({
    sessionFactory: binding,
    mcp: { stdio: true, authorizeServer: () => true },
    ...options,
  });
  cleanup.push(() => result.connection.close());
  await result.request("initialize", { protocolVersion: 1 });
  return result;
}

it("connects isolated stdio servers with cwd/argv/env, falls back, and closes every child", async () => {
  vi.stubEnv("ACP_TEST_PROVIDER_SECRET", "must-not-be-inherited");
  const sessions = manager();
  const a = await sessions.create(root, capabilities, [server(), server("editor!")]);
  const b = await sessions.create(root, capabilities, [server()]);
  const toolsA = sessions.get(a).context.mcpServers.flatMap((entry) => entry.tools);
  const toolsB = sessions.get(b).context.mcpServers.flatMap((entry) => entry.tools);
  expect(toolsA[0]!.name).toMatch(/^mcp_[a-f0-9]{16}_echo$/);
  expect(toolsA[0]!.name).not.toBe(toolsA[1]!.name);
  expect(toolsA[0]!.name).toBe(toolsB[0]!.name);
  expect(toolsA[0]).not.toBe(toolsB[0]);
  expect(toolsA.every((tool) => tool.requiresApproval === true)).toBe(true);
  expect((await records())[0]).toMatchObject({
    cwd: root,
    args: ["literal; argument"],
    supplied: "provided",
    inheritedSecret: null,
  });
  expect(
    (await records())
      .filter((entry) => !["start", "exit"].includes(entry.event))
      .slice(0, 4)
      .map((entry) => entry.event),
  ).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list"]);
  await sessions.get(a).close();
  expect(
    (await records()).filter((entry) => entry.event === "start").length -
      (await records()).filter((entry) => entry.event === "exit").length,
  ).toBe(1);
  await expectClosed("editor!");
  await sessions.close();
  await expectClosed();
});

it.each([
  "duplicate env",
  "duplicate headers",
  "invalid env",
  "duplicate names",
  "unsupported acp",
  "SSE",
])("validates the complete declaration list before spawning: %s", async (scenario) => {
  const factory = vi.fn(binding);
  const fixture = await peer({ sessionFactory: factory, mcp: { http: true } });
  const invalid =
    scenario === "duplicate env"
      ? {
          ...server("bad"),
          env: [
            { name: "KEY", value: "one" },
            { name: "KEY", value: "two" },
          ],
        }
      : scenario === "invalid env"
        ? { ...server("bad"), env: [{ name: "BAD=KEY", value: "x" }] }
        : scenario === "duplicate names"
          ? server()
          : scenario === "unsupported acp"
            ? { type: "acp", name: "bad" }
            : {
                type: scenario === "SSE" ? "sse" : "http",
                name: "bad",
                url: "http://localhost/mcp",
                headers: [
                  { name: "Authorization", value: "one" },
                  { name: "authorization", value: "two" },
                ],
              };
  const reply = await fixture.request("session/new", {
    cwd: root,
    mcpServers: [server(), invalid],
  });
  expect(reply.error).toBeDefined();
  expect(factory).not.toHaveBeenCalled();
  expect(await records()).toEqual([]);
});

it("authorizes all launches before spawning any child", async () => {
  const authorize = vi.fn((entry: { name: string }) => entry.name !== "denied");
  const sessions = manager({ mcp: { stdio: true, authorizeServer: authorize } });
  await expect(
    sessions.create(root, capabilities, [server(), server("denied")]),
  ).rejects.toMatchObject({ kind: "policy_denied" });
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(Object.isFrozen(authorize.mock.calls[0]![0])).toBe(true);
  expect(await records()).toEqual([]);
});

it.each([
  {},
  { stdio: true },
  { authorizeServer: () => true },
  { stdio: true, authorizeServer: () => false },
  { stdio: true, authorizeServer: () => "allow" as unknown as boolean },
])("denies process launch unless the host opts in AND explicitly approves: %j", async (mcp) => {
  const factory = vi.fn(binding);
  const sessions = manager({ mcp, sessionFactory: factory });
  await expect(sessions.create(root, capabilities, [server()])).rejects.toMatchObject({
    kind: "policy_denied",
  });
  expect(factory).not.toHaveBeenCalled();
  expect(await records()).toEqual([]);
});

it.each([
  "http://127.0.0.1/mcp",
  "http://localhost/mcp",
  "http://10.1.2.3/mcp",
  "http://169.254.169.254/mcp",
  "http://[::1]/mcp",
  "http://[::ffff:7f00:1]/mcp",
  "http://[fd00:ec2::254]/mcp",
])("reuses MCP URL safety for untrusted HTTP without reaching the network: %s", async (url) => {
  const sessions = manager({ mcp: { http: true } });
  await expect(
    sessions.create(root, capabilities, [{ type: "http", name: "blocked", url, headers: [] }]),
  ).rejects.toMatchObject({ kind: "configuration_error" });
});

it.each(["initialize-fail", "fail", "duplicate"])(
  "rolls back all children when setup fails: %s",
  async (mode) => {
    const factory = vi.fn(binding);
    const sessions = manager({ sessionFactory: factory });
    await expect(
      sessions.create(root, capabilities, [server(), server("bad", mode)]),
    ).rejects.toMatchObject({ kind: "configuration_error" });
    expect(factory).not.toHaveBeenCalled();
    for (const name of ["editor", "bad"]) {
      await expectClosed(name);
    }
  },
);

it.each(["omitted", "stripped approval", "collision", "throw"])(
  "cleans up on invalid factory registration: %s",
  async (mode) => {
    const dispose = vi.fn();
    const sessions = manager({
      sessionFactory(context) {
        if (mode === "throw") throw new Error("private failure");
        const tool = context.mcpServers[0]!.tools[0]!;
        const mcpServers =
          mode === "omitted"
            ? []
            : mode === "stripped approval"
              ? [{ ...context.mcpServers[0]!, tools: [{ ...tool, requiresApproval: false }] }]
              : context.mcpServers;
        return {
          agent: new Agent({
            id: "bad",
            model: makeAgent().model,
            mcpServers,
            tools:
              mode === "collision"
                ? [{ name: tool.name, definition: () => tool.definition(""), call: () => "local" }]
                : [],
          }),
          dispose,
        };
      },
    });
    await expect(sessions.create(root, capabilities, [server()])).rejects.toMatchObject({
      kind: "configuration_error",
    });
    await expectClosed();
    expect(dispose).toHaveBeenCalledTimes(mode === "throw" || mode === "collision" ? 0 : 1);
  },
);

it("closes negotiation on disconnect and disposes a late factory even if its disposer throws", async () => {
  const sessions = manager();
  const setup = sessions.create(root, capabilities, [server("editor", "hang")]);
  const rejected = expect(setup).rejects.toMatchObject({ kind: "connection_closed" });
  await vi.waitFor(
    async () => expect((await records()).some((entry) => entry.event === "tools/list")).toBe(true),
    { timeout: 10_000 },
  );
  await sessions.close();
  await rejected;
  await expectClosed();

  const gate = deferred();
  const dispose = vi.fn(() => {
    throw new Error("cleanup failure");
  });
  const late = manager({
    sessionFactory: async (context) => {
      contexts.push(context);
      await gate.promise;
      return { ...binding(context), dispose };
    },
  });
  const pending = late.create(root, capabilities, [server("late")]);
  const lateRejected = expect(pending).rejects.toMatchObject({ kind: "connection_closed" });
  await vi.waitFor(() => expect(contexts).toHaveLength(1), { timeout: 10_000 });
  const closed = late.close();
  gate.resolve();
  await closed;
  await lateRejected;
  expect(dispose).toHaveBeenCalledOnce();
  await expectClosed("late");
});

it.each(["allow", "reject", "cancel"])(
  "bridges real MCP calls through once-only permission: %s",
  async (decision) => {
    const fixture = await peer({
      sessionFactory(context) {
        let turn = 0;
        const model = makeAgent().model;
        model.completion = async (): Promise<CompletionResponse> => ({
          choice:
            turn++ === 0
              ? [
                  {
                    type: "tool-call",
                    toolCallId: "call",
                    toolName: context.mcpServers[0]!.tools[0]!.name,
                    input: {},
                  },
                ]
              : [{ type: "text", text: "done" }],
          usage: Usage.empty(),
          rawResponse: {},
        });
        return {
          agent: new Agent({
            id: "permission",
            model,
            mcpServers: context.mcpServers,
            retries: false,
          }),
        };
      },
    });
    const created = await fixture.request("session/new", { cwd: root, mcpServers: [server()] });
    const sessionId = created.result!.sessionId!;
    const prompt = fixture.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    await vi.waitFor(() =>
      expect(fixture.responses.some((entry) => entry.method === "session/request_permission")).toBe(
        true,
      ),
    );
    expect((await records()).some((entry) => entry.event === "tools/call")).toBe(false);
    const permission = fixture.responses.find(
      (entry) => entry.method === "session/request_permission",
    )!;
    if (decision === "cancel")
      fixture.input.write(
        JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }) + "\n",
      );
    fixture.input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: permission.id,
        result: {
          outcome: {
            outcome: "selected",
            optionId: decision === "reject" ? "reject_once" : "allow_once",
          },
        },
      }) + "\n",
    );
    expect((await prompt).result?.stopReason).toBe(
      decision === "cancel" ? "cancelled" : "end_turn",
    );
    expect((await records()).filter((entry) => entry.event === "tools/call")).toHaveLength(
      decision === "allow" ? 1 : 0,
    );
  },
);
