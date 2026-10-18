import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import { agentProtocolRouter } from "@agentclientprotocol/sdk/experimental/v2";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorClient } from "../src/editor-tools.js";
import { InMemoryAcpSessionStore } from "../src/session-store.js";
import { SessionManager } from "../src/session-manager.js";
import { resolveLimits } from "../src/limits.js";
import { createAcpConnection } from "../src/connection.js";
import { createV1Agent } from "../src/wire/v1.js";
import { createV1Stream } from "../src/wire/stream.js";
import { Transcript, assertReplayFits } from "../src/transcript.js";
import type { AcpOptions, AcpSessionContext } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const caps = { readTextFile: true, writeTextFile: true, terminal: true, elicitationForm: false };
const editorTools = { readTextFile: true, writeTextFile: true, terminal: true };
const prompt = [{ type: "text" as const, text: "hello" }];
let root: string;
let cwd: string;
let outside: string;
const cleanups: Array<() => Promise<unknown>> = [];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp-hardening-")));
  cwd = join(root, "workspace");
  outside = join(root, "workspace-other");
  await Promise.all([mkdir(cwd), mkdir(outside)]);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await rm(root, { recursive: true, force: true });
});
function editor(): EditorClient {
  return {
    read: vi.fn(async () => "buffer"),
    write: vi.fn(async () => {}),
    create: vi.fn(async () => "id"),
    wait: vi.fn(async () => ({ exitCode: 0, signal: null })),
    output: vi.fn(async () => ({ output: "éé", truncated: true })),
    kill: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
}
function factory(context: AcpSessionContext) {
  return {
    agent: new Agent({ id: "paths", model: makeAgent().model, tools: context.editorTools }),
  };
}
async function session(options: Partial<AcpOptions> = {}, client = editor()) {
  const manager = new SessionManager({ sessionFactory: factory, editorTools, ...options });
  cleanups.push(() => manager.close());
  const current = manager.get(await manager.create(cwd, caps, [], () => client));
  return {
    manager,
    current,
    client,
    call: (name: string, input: unknown) =>
      Promise.resolve(current.context.editorTools.find((tool) => tool.name === name)!.call(input)),
  };
}

it("confines every editor operation to cwd even with broad session admission roots", async () => {
  await symlink(outside, join(cwd, "escape"));
  await symlink(join(outside, "missing"), join(cwd, "dangling"));
  const fixture = await session({ workspaceRoots: [root] });
  expect(fixture.current.context.policy.workspaceRoots).toEqual([cwd]);
  for (const path of [
    outside,
    join(outside, "new"),
    "../workspace-other/new",
    "escape/new",
    "dangling/new",
  ]) {
    for (const [name, input] of [
      ["editor_read_text_file", { path }],
      ["editor_write_text_file", { path, content: "no" }],
      ["editor_run_terminal", { command: "echo", cwd: path }],
    ] as const)
      await expect(fixture.call(name, input)).rejects.toMatchObject({ kind: "policy_denied" });
  }
  expect(fixture.client.read).not.toHaveBeenCalled();
  expect(fixture.client.write).not.toHaveBeenCalled();
  expect(fixture.client.create).not.toHaveBeenCalled();
  await fixture.call("editor_read_text_file", { path: join(cwd, "new") });
  await fixture.call("editor_write_text_file", { path: "sub/../new", content: "yes" });
  expect(fixture.client.write).toHaveBeenCalledWith(
    join(cwd, "new"),
    "yes",
    expect.any(AbortSignal),
  );
});

it("widens editor paths only through explicit host policy, including canonical symlink targets", async () => {
  await symlink(outside, join(cwd, "approved"));
  const fixture = await session({ editorWorkspaceRoots: [outside] });
  await fixture.call("editor_read_text_file", { path: "approved/new" });
  await fixture.call("editor_write_text_file", { path: join(outside, "new"), content: "yes" });
  await fixture.call("editor_run_terminal", { command: "echo", cwd: outside });
  expect(fixture.client.create).toHaveBeenCalledWith("echo", [], outside, 1024 * 1024);
});

it.each([3, 4])(
  "bounds terminal retention in UTF-8 bytes and always releases it (limit=%s)",
  async (limit) => {
    const fixture = await session({ limits: { maxTerminalOutputBytes: limit } });
    const operation = fixture.call("editor_run_terminal", { command: "echo" });
    if (limit < 4) await expect(operation).rejects.toMatchObject({ kind: "resource_limit" });
    else await expect(operation).resolves.toMatchObject({ output: "éé", truncated: true });
    expect(fixture.client.create).toHaveBeenCalledWith("echo", [], cwd, limit);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  },
);

it.each(["entries", "bytes"])(
  "rejects oversized replay %s before factory, teardown or any update",
  async (bound) => {
    const binding = vi.fn(() => makeAgent());
    const manager = new SessionManager({
      sessionFactory: binding,
      limits: bound === "entries" ? { maxReplayBatchEntries: 1 } : { maxReplayBatchBytes: 10 },
    });
    cleanups.push(() => manager.close());
    const id = await manager.create(cwd, caps);
    const original = manager.get(id);
    await original.prompt(prompt);
    const send = vi.fn(async () => {});
    await expect(manager.restore(id, cwd, caps, [], undefined, send)).rejects.toMatchObject({
      kind: "resource_limit",
    });
    expect(binding).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(manager.get(id)).toBe(original);
    // Silent resume can still attach to history larger than the replay policy.
    await manager.restore(id, cwd, caps);
    expect(binding).toHaveBeenCalledTimes(2);
  },
);

it("accepts exact replay boundaries and merges tiny text deltas without mutating history or dropping text", () => {
  const saved = [{ type: "text" as const, text: "a" }];
  const transcript = new Transcript(cwd, 1024 * 1024, saved);
  for (let i = 0; i < 1000; i++) transcript.add({ type: "text", text: 'é"\\\n' });
  expect(saved[0]!.text).toBe("a");
  expect(transcript.entries).toEqual([{ type: "text", text: "a" + 'é"\\\n'.repeat(1000) }]);
  const bytes =
    2 +
    transcript.entries.reduce(
      (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)) + 1,
      0,
    );
  assertReplayFits(
    transcript.entries,
    resolveLimits({ maxReplayBatchEntries: 1, maxReplayBatchBytes: bytes }),
  );
  expect(() =>
    assertReplayFits(transcript.entries, resolveLimits({ maxReplayBatchBytes: bytes - 1 })),
  ).toThrow("resource_limit");
  const exact = new Transcript(cwd, bytes, transcript.entries);
  expect(() => exact.add({ type: "text", text: "x" })).toThrow("resource_limit");
  expect(exact.entries).toEqual(transcript.entries);
  const chunks = new Transcript(cwd, 1024 * 1024);
  for (let i = 0; i < 3; i++) chunks.add({ type: "text", text: "x".repeat(32 * 1024) });
  expect(chunks.entries).toHaveLength(2);
  expect(() => assertReplayFits([], resolveLimits({ maxReplayBatchBytes: 1 }))).toThrow(
    "resource_limit",
  );
});

it.each([{ invalid: 1 }, { method: "unknown" }, { jsonrpc: "2.0", method: null, id: "bad" }])(
  "bounds malformed envelope error replies even when the output is stalled: %j",
  async (envelope) => {
    const output = deferred();
    const connection = createAcpConnection({
      limits: { maxConcurrentRequests: 2 },
      sessionFactory: () => makeAgent(),
      input: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode((JSON.stringify(envelope) + "\n").repeat(3)));
        },
      }),
      output: new WritableStream({ write: () => output.promise }),
    });
    try {
      await connection.closed;
    } finally {
      output.resolve();
      await connection.close();
    }
  },
);

it("closes before dispatch when concurrent inbound RPC capacity is exceeded", async () => {
  const started = deferred();
  const fixture = wireFixture({
    limits: { maxConcurrentRequests: 1 },
    sessionFactory: (context) =>
      makeAgent(async () => {
        started.resolve();
        await new Promise<void>((resolve) =>
          context.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }),
  });
  cleanups.push(() => fixture.connection.close());
  await fixture.request("initialize", { protocolVersion: 1 });
  const id = (await fixture.request("session/new", { cwd, mcpServers: [] })).result!.sessionId!;
  fixture.input.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 90,
      method: "session/prompt",
      params: { sessionId: id, prompt },
    }) + "\n",
  );
  await started.promise;
  fixture.input.write(
    '{"jsonrpc":"2.0","id":91,"method":"authenticate","params":{"methodId":"unused"}}\n',
  );
  await fixture.connection.closed;
  expect(fixture.responses.some((response) => response.id === 91)).toBe(false);
});

it("does not let parser errors free a pending null-ID RPC's capacity", async () => {
  const started = deferred();
  const finish = deferred();
  const store = new InMemoryAcpSessionStore();
  store.list = async () => {
    started.resolve();
    await finish.promise;
    return { sessions: [] };
  };
  const fixture = wireFixture({
    sessionFactory: () => makeAgent(),
    sessionStore: store,
    limits: { maxConcurrentRequests: 1 },
  });
  cleanups.push(async () => {
    finish.resolve();
    await fixture.connection.close();
  });
  await fixture.request("initialize", { protocolVersion: 1 });
  fixture.input.write('{"jsonrpc":"2.0","id":null,"method":"session/list","params":{}}\n');
  await started.promise;
  fixture.input.write("42\n");
  await vi.waitFor(() =>
    expect(fixture.responses.some((r) => r.error?.code === -32600)).toBe(true),
  );
  fixture.input.write(
    '{"jsonrpc":"2.0","id":99,"method":"authenticate","params":{"methodId":"unused"}}\n',
  );
  await fixture.connection.closed;
  expect(fixture.responses.some((r) => r.id === 99)).toBe(false);
});

it.each([0, -1, 1.5, Infinity, NaN])(
  "validates wire byte limits before consuming input: %s",
  (maxMessageBytes) => {
    expect(() => wireFixture({ maxMessageBytes, sessionFactory: () => makeAgent() })).toThrow(
      TypeError,
    );
  },
);

it("can register the thin v1 connector with the SDK router while keeping v2 disabled", async () => {
  const received = deferred<string>();
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const options = {
    sessionFactory: () => makeAgent(),
    input: new ReadableStream<Uint8Array>({
      start(controller) {
        input = controller;
      },
    }),
    output: new WritableStream<Uint8Array>({
      write(chunk) {
        received.resolve(new TextDecoder().decode(chunk));
      },
    }),
  };
  const sessions = new SessionManager(options);
  const routed = agentProtocolRouter()
    .withV1(createV1Agent(sessions, options))
    .connect(createV1Stream(options));
  try {
    input.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 2, info: { name: "fixture", version: "1" }, capabilities: {} },
        }) + "\n",
      ),
    );
    expect(JSON.parse(await received.promise)).toMatchObject({ result: { protocolVersion: 1 } });
  } finally {
    input.close();
    await routed.closed;
    await sessions.close();
  }
});

it.each([
  "factory",
  "policy",
  "store-read",
  "store-write",
  "dispose",
  "config",
  "command",
  "presentation",
  "provider",
])("sends only fixed errors to the wire after a private %s failure", async (stage) => {
  const secret = "sk-fixture-secret /private/key.pem Authorization: Bearer fixture";
  const fail = () => {
    throw new Error(secret, { cause: new Error("nested secret") });
  };
  const store = new InMemoryAcpSessionStore();
  if (stage === "store-write") vi.spyOn(store, "put").mockImplementation(fail);
  if (stage === "store-read") vi.spyOn(store, "get").mockImplementation(fail);
  const fixture = wireFixture({
    sessionStore: store,
    mcp: { stdio: true, authorizeServer: fail },
    models: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
    commands: [{ name: "fail", description: "Fail", expand: fail }],
    sessionFactory(context) {
      if (stage === "factory" || (stage === "config" && context.config.model === "b")) fail();
      const model = makeAgent(stage === "provider" ? async () => fail() : undefined).model;
      if (stage === "presentation")
        model.completion = async () => ({
          choice: [{ type: "tool-call", toolCallId: "call", toolName: "private", input: {} }],
          usage: Usage.empty(),
          rawResponse: {},
        });
      const binding: { agent: Agent; dispose?: () => never; toolPresentation?: () => never } = {
        agent: new Agent({
          id: "errors",
          model,
          retries: false,
          tools:
            stage === "presentation"
              ? [
                  {
                    name: "private",
                    requiresApproval: true,
                    definition: () => ({
                      name: "private",
                      description: "Private",
                      parameters: { type: "object" },
                    }),
                    call: () => "done",
                  },
                ]
              : [],
        }),
      };
      if (stage === "dispose") binding.dispose = fail;
      if (stage === "presentation") binding.toolPresentation = fail;
      return binding;
    },
  });
  cleanups.push(() => fixture.connection.close());
  await fixture.request("initialize", { protocolVersion: 1 });
  let reply;
  if (stage === "store-read")
    reply = await fixture.request("session/resume", { sessionId: "unknown", cwd });
  else {
    const created = await fixture.request("session/new", {
      cwd,
      mcpServers:
        stage === "policy"
          ? [{ name: "privileged", command: process.execPath, args: [], env: [] }]
          : [],
    });
    if (created.error) reply = created;
    else {
      const sessionId = created.result!.sessionId!;
      if (stage === "dispose") reply = await fixture.request("session/close", { sessionId });
      else if (stage === "config")
        reply = await fixture.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: "b",
        });
      else
        reply = await fixture.request("session/prompt", {
          sessionId,
          prompt: stage === "command" ? [{ type: "text", text: "/fail" }] : prompt,
        });
    }
  }
  expect(reply.error).toMatchObject({ code: -32603, message: "Internal error" });
  expect(Object.keys(reply.error!)).toEqual(["code", "message", "data"]);
  expect(JSON.stringify(fixture.responses)).not.toMatch(
    /sk-fixture|key\.pem|Authorization|nested secret|\bat .+\(/,
  );
});
