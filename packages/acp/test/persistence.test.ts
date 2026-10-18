import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import { Usage, type StreamingCompletionModel } from "@anvia/core/completion";
import {
  FileAcpSessionStore,
  InMemoryAcpSessionStore,
  type AcpSessionRecord,
  type AcpSessionStore,
} from "../src/session-store.js";
import { SessionManager } from "../src/session-manager.js";
import type { AcpOptions } from "../src/types.js";
import { projectTranscript, type AcpTranscriptEntry } from "../src/transcript.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";
import { stdioClient } from "./stdio-client.js";

const capabilities = {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
};
const text = (text: string) => [{ type: "text" as const, text }];
let root: string;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp-persist-")));
});
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await rm(root, { recursive: true, force: true });
});
function manager(options: Partial<AcpOptions> = {}) {
  const result = new SessionManager({ sessionFactory: () => makeAgent(), ...options });
  cleanup.push(() => result.close());
  return result;
}
function record(sessionId: string, cwd = root): AcpSessionRecord {
  return {
    version: 1,
    sessionId,
    cwd,
    title: "Empty",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: { mode: "ask" },
    nextToolId: 0,
    messages: [],
    transcript: [],
  };
}

it("restarts real processes, replays once with stable tool IDs, resumes silently and continues without executing history", async () => {
  const path = join(root, "sessions.json");
  const launch = async () => {
    const client = stdioClient("test/fixtures/persistence-host.mjs", [path]);
    cleanup.push(client.close);
    const init = await client.request("initialize", { protocolVersion: 1 });
    expect(init.result).toMatchObject({
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {}, list: {}, close: {}, delete: {} },
      },
    });
    return client;
  };
  const first = await launch();
  const created = await first.request("session/new", { cwd: root, mcpServers: [] });
  const { sessionId } = created.result as { sessionId: string };
  const prompt = first.start("session/prompt", { sessionId, prompt: text("fixture:tools") });
  let after = first.frames.length;
  for (let index = 0; index < 2; index++) {
    const approval = await first.waitFor(
      (frame) => frame.method === "session/request_permission",
      after,
    );
    after = first.frames.indexOf(approval) + 1;
    first.reply(approval, { outcome: { outcome: "selected", optionId: "allow_once" } });
  }
  expect((await prompt.response).result).toEqual({ stopReason: "end_turn" });
  const updates = first.frames
    .filter((frame) => frame.method === "session/update")
    .map((frame) => frame.params!.update);
  const toolIds = updates
    .filter((update) => (update as { sessionUpdate: string }).sessionUpdate === "tool_call")
    .map((update) => (update as { toolCallId: string }).toolCallId);
  expect(new Set(toolIds).size).toBe(2);
  await first.close();
  expect((await stat(path)).mode & 0o777).toBe(0o600);

  const second = await launch();
  expect(
    (await second.request("session/load", { sessionId, cwd: root, mcpServers: [] })).error,
  ).toBeUndefined();
  const replay = second.frames
    .filter((frame) => frame.method === "session/update")
    .map((frame) => frame.params!.update);
  expect(replay).toEqual([
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "fixture:tools" } },
    ...updates.slice(0, -2),
    {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: updates
          .slice(-2)
          .map((update) => (update as { content: { text: string } }).content.text)
          .join(""),
      },
    },
  ]);
  expect(second.stderr()).not.toContain("fixture generation");
  expect(second.stderr()).not.toContain("fixture tool executed");
  expect((await second.request("session/close", { sessionId })).result).toEqual({});
  const count = second.frames.filter((frame) => frame.method === "session/update").length;
  expect((await second.request("session/resume", { sessionId, cwd: root })).error).toBeUndefined();
  expect(second.frames.filter((frame) => frame.method === "session/update")).toHaveLength(count);
  const mark = second.frames.length;
  expect(
    (await second.request("session/prompt", { sessionId, prompt: text("continue") })).result,
  ).toEqual({ stopReason: "end_turn" });
  const continued = second.frames
    .slice(mark)
    .filter((frame) => frame.method === "session/update")
    .map((frame) => (frame.params!.update as { content: { text: string } }).content.text)
    .join("");
  expect(JSON.parse(continued)).toMatchObject({
    users: [text("fixture:tools"), text("continue")],
    executions: 0,
  });
  expect(second.stderr()).not.toContain("fixture tool executed");
  await second.close();

  const third = await launch();
  expect((await third.request("session/list", { cwd: root })).result).toMatchObject({
    sessions: [{ sessionId, title: "fixture:tools" }],
  });
  expect((await third.request("session/delete", { sessionId })).result).toEqual({});
  expect(
    (await third.request("session/load", { sessionId, cwd: root, mcpServers: [] })).error,
  ).toMatchObject({ data: { kind: "session_not_found" } });
  expect((await third.request("session/list", {})).result).toEqual({ sessions: [] });
});

it("does not reuse uncommitted tool IDs when silently resuming after a restart", async () => {
  const path = join(root, "cancelled.json");
  const launch = async () => {
    const client = stdioClient("test/fixtures/persistence-host.mjs", [path]);
    cleanup.push(client.close);
    await client.request("initialize", { protocolVersion: 1 });
    return client;
  };
  const first = await launch();
  const created = await first.request("session/new", { cwd: root, mcpServers: [] });
  const { sessionId } = created.result as { sessionId: string };
  const interruptedTool = async (client: typeof first) => {
    const prompt = client.start("session/prompt", { sessionId, prompt: text("fixture:tools") });
    await client.waitFor((frame) => frame.method === "session/request_permission");
    const update = client.frames.find((frame) => frame.method === "session/update")!.params!
      .update as { toolCallId: string };
    client.notify("session/cancel", { sessionId });
    expect((await prompt.response).result).toEqual({ stopReason: "cancelled" });
    return update.toolCallId;
  };
  const originalId = await interruptedTool(first);
  await first.close();
  const second = await launch();
  expect((await second.request("session/resume", { sessionId, cwd: root })).error).toBeUndefined();
  expect(second.frames.some((frame) => frame.method === "session/update")).toBe(false);
  expect(await interruptedTool(second)).not.toBe(originalId);
});

it("replays terminal command presentation after restart without repeating editor callbacks", async () => {
  const path = join(root, "terminal.json");
  const launch = async () => {
    const client = stdioClient("test/fixtures/persistence-host.mjs", [path]);
    cleanup.push(client.close);
    await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
    });
    return client;
  };
  const first = await launch();
  const created = await first.request("session/new", { cwd: root, mcpServers: [] });
  const { sessionId } = created.result as { sessionId: string };
  const prompt = first.start("session/prompt", { sessionId, prompt: text("fixture:terminal") });
  const approval = await first.waitFor((frame) => frame.method === "session/request_permission");
  first.reply(approval, { outcome: { outcome: "selected", optionId: "allow_once" } });
  for (const [method, result] of [
    ["terminal/create", { terminalId: "terminal-1" }],
    ["terminal/wait_for_exit", { exitCode: 0 }],
    ["terminal/output", { output: "private terminal output", truncated: false }],
    ["terminal/release", {}],
  ] as const) {
    const request = await first.waitFor((frame) => frame.method === method);
    first.reply(request, result);
  }
  expect((await prompt.response).result).toEqual({ stopReason: "end_turn" });
  const updates = first.frames
    .filter((frame) => frame.method === "session/update")
    .map((frame) => frame.params!.update);
  expect(updates).toContainEqual(
    expect.objectContaining({
      sessionUpdate: "tool_call_update",
      content: [
        {
          type: "content",
          content: { type: "text", text: `Command: fixture-command | cwd: ${root}` },
        },
      ],
    }),
  );
  await first.close();
  const second = await launch();
  expect(
    (await second.request("session/load", { sessionId, cwd: root, mcpServers: [] })).error,
  ).toBeUndefined();
  expect(
    second.frames
      .filter((frame) => frame.method === "session/update")
      .map((frame) => frame.params!.update),
  ).toEqual([
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "fixture:terminal" } },
    ...updates.slice(0, -2),
    {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: updates
          .slice(-2)
          .map((update) => (update as { content: { text: string } }).content.text)
          .join(""),
      },
    },
  ]);
  expect(second.frames.some((frame) => frame.method?.startsWith("terminal/"))).toBe(false);
  expect(JSON.stringify(second.frames)).not.toContain("private terminal output");
});

it.each([
  { type: "user", content: { type: "text" } },
  { type: "user", content: { type: "resource", uri: "file:///context" } },
  { type: "user", content: { type: "resource_link", name: "context" } },
  {
    type: "tool-update",
    id: "tool-1",
    status: "pending",
    diffs: [{ path: "file.ts", newText: "safe", oldText: { signature: "private" } }],
  },
])("rejects malformed stored display fields before replay: %j", (entry) => {
  expect(() => projectTranscript(entry as AcpTranscriptEntry, root)).toThrow("configuration_error");
});

it("keeps original input and visible output separate from private model history and reasoning", async () => {
  const store = new InMemoryAcpSessionStore();
  const model: StreamingCompletionModel = {
    ...makeAgent().model,
    capabilities: { ...makeAgent().model.capabilities, streaming: true },
    async *streamCompletion() {
      yield { type: "reasoning_delta", delta: "private-thought", signature: "provider-signature" };
      yield { type: "text_delta", delta: "public reply" };
      yield {
        type: "final",
        response: {
          choice: [
            {
              type: "reasoning",
              text: "private-thought",
              details: [{ type: "text", text: "private-thought", signature: "provider-signature" }],
            },
            { type: "text", text: "public reply" },
          ],
          usage: Usage.empty(),
          rawResponse: { signature: "provider-signature" },
        },
      };
    },
  };
  const options: AcpOptions = {
    sessionStore: store,
    reasoning: true,
    commands: [{ name: "brief", description: "Brief", expand: () => "private expansion" }],
    sessionFactory: () => ({
      agent: new Agent({ id: "private", instructions: "private-system", model }),
    }),
  };
  const first = manager(options);
  const id = await first.create(root, capabilities);
  const live: unknown[] = [];
  await first.get(id).prompt(text("/brief"), async (update) => {
    live.push(update);
  });
  expect(JSON.stringify(live)).toContain("private-thought");
  const saved = (await store.get(id))!;
  expect(JSON.stringify(saved.messages)).toContain("private expansion");
  expect(saved.transcript).toEqual([
    { type: "user", content: { type: "text", text: "/brief" } },
    { type: "text", text: "public reply" },
  ]);
  // Legacy/host records cannot turn extra private fields or unknown events into wire output.
  await store.put({
    ...saved,
    transcript: [
      ...saved.transcript,
      { type: "thought", text: "opaque-reasoning" },
      { type: "text", text: "safe", signature: "provider-signature", rawInput: "private-input" },
      { type: "system", text: "private-system" },
    ] as unknown as AcpTranscriptEntry[],
  });
  await first.close();
  const second = manager(options);
  const replay: unknown[] = [];
  await second.restore(id, root, capabilities, [], undefined, async (entry) => {
    replay.push(entry);
  });
  expect(JSON.stringify(replay)).not.toMatch(/private|opaque|signature/);
  expect(replay).toEqual([
    { type: "user", content: { type: "text", text: "/brief" } },
    { type: "text", text: "public replysafe" },
  ]);
});

it("distinguishes empty existing sessions from absent records; close retains data, delete removes it", async () => {
  const sessions = manager();
  const id = await sessions.create(root, capabilities);
  await sessions.closeSession(id);
  await sessions.closeSession(id);
  await expect(sessions.restore("missing", root, capabilities)).rejects.toMatchObject({
    kind: "session_not_found",
  });
  const restored = await sessions.restore(id, root, capabilities);
  expect(restored.transcript()).toEqual([]);
  await restored.prompt(text("hello"));
  await sessions.deleteSession(id);
  await expect(sessions.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "session_not_found",
  });
});

it("persists config and rejects changed workspace or removed host options before factory/replay", async () => {
  const store = new InMemoryAcpSessionStore();
  const factory = vi.fn(() => makeAgent());
  const options = {
    sessionStore: store,
    sessionFactory: factory,
    readOnlyMode: true,
    models: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
  };
  const first = manager(options);
  const id = await first.create(root, capabilities);
  await first.get(id).prompt(text("hello"));
  await first.get(id).setConfig("model", "b");
  await first.get(id).setConfig("mode", "read-only");
  await first.close();
  const second = manager(options);
  const session = await second.restore(id, root, capabilities);
  expect(session.context.config).toEqual({ model: "b", mode: "read-only" });
  expect(session.transcript()).toHaveLength(2);
  await second.close();
  await mkdir(join(root, "other"));
  const restricted = manager({ ...options, workspaceRoots: [join(root, "other")] });
  const calls = factory.mock.calls.length;
  await expect(restricted.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "policy_denied",
  });
  await expect(
    manager(options).restore(id, join(root, "other"), capabilities),
  ).rejects.toMatchObject({ kind: "policy_denied" });
  await expect(
    manager({ sessionStore: store }).restore(id, root, capabilities),
  ).rejects.toMatchObject({ kind: "invalid_config" });
  expect(factory).toHaveBeenCalledTimes(calls);
});

it("filters workspaces before cursor pagination and validates cursor scope", async () => {
  const store = new InMemoryAcpSessionStore();
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  for (let index = 0; index < 52; index++)
    await store.put(record(String(index).padStart(3, "0"), join(root, "a")));
  await store.put(record("other", join(root, "b")));
  const sessions = manager({ sessionStore: store, workspaceRoots: [join(root, "a")] });
  const page = await sessions.list();
  expect(page.sessions).toHaveLength(50);
  expect(page.nextCursor).toBeTypeOf("string");
  const next = await sessions.list(undefined, page.nextCursor);
  expect(next.sessions.map((entry) => entry.sessionId)).toEqual(["050", "051"]);
  expect(next.nextCursor).toBeUndefined();
  await expect(sessions.list(root)).rejects.toMatchObject({ kind: "policy_denied" });
  await expect(sessions.list(join(root, "a"), page.nextCursor)).rejects.toMatchObject({
    kind: "invalid_cursor",
  });
  await expect(sessions.list(undefined, "invalid")).rejects.toMatchObject({
    kind: "invalid_cursor",
  });
  expect(await sessions.list(join(root, "a"))).toMatchObject({ sessions: expect.any(Array) });
});

it("advertises optional store operations only when available and requires initialization", async () => {
  const memory = new InMemoryAcpSessionStore();
  const store: AcpSessionStore = { get: memory.get.bind(memory), put: memory.put.bind(memory) };
  const wire = wireFixture({ sessionStore: store, sessionFactory: () => makeAgent() });
  cleanup.push(() => wire.connection.close());
  expect((await wire.request("session/list", {})).error).toMatchObject({
    data: { kind: "not_initialized" },
  });
  const init = await wire.request("initialize", { protocolVersion: 1 });
  expect(init.result?.agentCapabilities).toMatchObject({
    loadSession: true,
    sessionCapabilities: { resume: {}, close: {} },
  });
  expect(
    (init.result?.agentCapabilities as { sessionCapabilities: unknown }).sessionCapabilities,
  ).toEqual({ resume: {}, close: {} });
  expect((await wire.request("session/list", {})).error?.code).toBe(-32601);
  expect((await wire.request("session/delete", { sessionId: "missing" })).error?.code).toBe(-32601);
});

it("locks restore through replay and rolls back runtime resources when replay fails", async () => {
  const disposed = vi.fn();
  const sessions = manager({ sessionFactory: () => ({ ...makeAgent(), dispose: disposed }) });
  const id = await sessions.create(root, capabilities);
  await sessions.get(id).prompt(text("hello"));
  await sessions.closeSession(id);
  const entered = deferred();
  const gate = deferred();
  const loading = sessions.restore(id, root, capabilities, [], undefined, async () => {
    entered.resolve();
    await gate.promise;
    throw new Error("broken output");
  });
  await entered.promise;
  expect(() => sessions.get(id)).toThrow("session_busy");
  await expect(sessions.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "session_busy",
  });
  await expect(sessions.deleteSession(id)).rejects.toMatchObject({ kind: "session_busy" });
  gate.resolve();
  await expect(loading).rejects.toThrow("broken output");
  expect(disposed).toHaveBeenCalledTimes(2);
  await sessions.restore(id, root, capabilities);
});

it("close cancels active work and waits for ownership before restore or delete", async () => {
  const gate = deferred();
  const entered = deferred();
  const sessions = manager({
    sessionFactory: () =>
      makeAgent(async () => {
        entered.resolve();
        await gate.promise;
      }),
  });
  const id = await sessions.create(root, capabilities);
  const prompt = sessions.get(id).prompt(text("interrupted"));
  await entered.promise;
  const closing = sessions.closeSession(id);
  await expect(prompt).resolves.toBe("cancelled");
  await expect(sessions.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "session_busy",
  });
  gate.resolve();
  await closing;
  const record = await sessions.store.get(id);
  expect(record?.messages).toEqual([]);
  expect(record?.transcript).toEqual([]);
  await sessions.restore(id, root, capabilities);
});

it("failed atomic writes retain prior history/config and never expose storage errors on the wire", async () => {
  const backing = new InMemoryAcpSessionStore();
  let fail = false;
  const store: AcpSessionStore = {
    get: backing.get.bind(backing),
    async put(value) {
      if (fail) throw new Error("private-database-secret");
      await backing.put(value);
    },
  };
  const sessions = manager({
    sessionStore: store,
    models: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
  });
  const id = await sessions.create(root, capabilities);
  await sessions.get(id).prompt(text("saved"));
  const before = await backing.get(id);
  fail = true;
  await expect(sessions.get(id).prompt(text("lost"))).rejects.toMatchObject({
    kind: "execution_failed",
  });
  await expect(sessions.get(id).setConfig("model", "b")).rejects.toThrow("private-database-secret");
  expect(sessions.get(id).context.config.model).toBe("a");
  expect(await backing.get(id)).toEqual(before);
  expect(await sessions.get(id).memory.load({ scope: { sessionId: id } })).toEqual(
    before!.messages,
  );
  const wire = wireFixture({ sessionStore: store, sessionFactory: () => makeAgent() });
  cleanup.push(() => wire.connection.close());
  await wire.request("initialize", { protocolVersion: 1 });
  const response = await wire.request("session/new", { cwd: root, mcpServers: [] });
  expect(response.error).toBeDefined();
  expect(JSON.stringify(response)).not.toContain("private-database-secret");
});

it("file store isolates snapshots, serializes writes, and rejects corrupt files without overwriting them", async () => {
  const path = join(root, "store.json");
  const store = new FileAcpSessionStore(path);
  expect(await store.get("missing")).toBeUndefined();
  await Promise.all([store.put(record("a")), store.put(record("b"))]);
  expect((await new FileAcpSessionStore(path).list({ limit: 50 })).sessions).toHaveLength(2);
  await writeFile(path, '[{"version":99}]');
  await expect(store.get("a")).rejects.toMatchObject({ kind: "configuration_error" });
  await expect(store.put(record("c"))).rejects.toMatchObject({ kind: "configuration_error" });
  expect(await readFile(path, "utf8")).toBe('[{"version":99}]');
});

it("finishes an in-flight atomic commit before close or delete can release ownership", async () => {
  const backing = new InMemoryAcpSessionStore();
  const entered = deferred();
  const gate = deferred();
  let delayed = false;
  const store: AcpSessionStore = {
    get: backing.get.bind(backing),
    delete: backing.delete.bind(backing),
    async put(value) {
      if (delayed) {
        entered.resolve();
        await gate.promise;
      }
      await backing.put(value);
    },
  };
  const sessions = manager({ sessionStore: store });
  const id = await sessions.create(root, capabilities);
  delayed = true;
  const prompt = sessions.get(id).prompt(text("committing"));
  await entered.promise;
  sessions.cancel(id);
  const closing = sessions.closeSession(id);
  await expect(sessions.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "session_busy",
  });
  expect((await backing.get(id))!.messages).toEqual([]);
  gate.resolve();
  await expect(prompt).resolves.toBe("end_turn");
  await closing;
  expect((await backing.get(id))!.messages).toHaveLength(2);
  await sessions.restore(id, root, capabilities);
  await sessions.deleteSession(id);
  await sessions.deleteSession(id);
  expect(await backing.get(id)).toBeUndefined();
});

it("rebinds an idle active session and rejects restore while a prompt is active", async () => {
  const entered = deferred();
  const gate = deferred();
  let wait = false;
  const disposed = vi.fn();
  const factory = vi.fn(() => ({
    ...makeAgent(async () => {
      if (wait) {
        entered.resolve();
        await gate.promise;
      }
    }),
    dispose: disposed,
  }));
  const sessions = manager({ sessionFactory: factory });
  const id = await sessions.create(root, capabilities);
  await sessions.get(id).prompt(text("saved"));
  const replay: AcpTranscriptEntry[] = [];
  const restored = await sessions.restore(id, root, capabilities, [], undefined, async (entry) => {
    replay.push(entry);
  });
  expect(factory).toHaveBeenCalledTimes(2);
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(replay).toHaveLength(2);
  expect(Object.isFrozen(restored.context.config)).toBe(true);
  wait = true;
  const active = restored.prompt(text("waiting"));
  await entered.promise;
  await expect(sessions.restore(id, root, capabilities)).rejects.toMatchObject({
    kind: "session_busy",
  });
  gate.resolve();
  await active;
});
