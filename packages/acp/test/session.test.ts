import { Agent } from "@anvia/core/agent";
import { Usage, type StreamingCompletionModel } from "@anvia/core/completion";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import type { AcpClientCapabilities, AcpOptions, AcpSessionContext } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const capabilities: AcpClientCapabilities = {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
};
const text = (value: string) => [{ type: "text" as const, text: value }];
let root: string;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "anvia-acp-")));
});
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await rm(root, { recursive: true, force: true });
});

function manager(options: Partial<AcpOptions> = {}) {
  const instance = new SessionManager({ sessionFactory: () => makeAgent(), ...options });
  cleanup.push(() => instance.close());
  return instance;
}

async function peer(options: Partial<AcpOptions> = {}) {
  const fixture = wireFixture({ sessionFactory: () => makeAgent(), ...options });
  cleanup.push(() => fixture.connection.close());
  await fixture.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true }, terminal: true, elicitation: { form: {} } },
  });
  return fixture;
}

describe("session ownership and memory", () => {
  it("isolates concurrent cwd, agents and multi-turn MemoryStore histories without chdir", async () => {
    const originalCwd = process.cwd();
    const gate = deferred();
    const contexts: AcpSessionContext[] = [];
    const models: ReturnType<typeof makeAgent>[] = [];
    const sessions = manager({
      sessionFactory(context) {
        contexts.push(context);
        const model = makeAgent(() => gate.promise);
        models.push(model);
        return model;
      },
    });
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    const [a, b] = await Promise.all([
      sessions.create(join(root, "a"), capabilities),
      sessions.create(join(root, "b"), capabilities),
    ]);
    expect(a).not.toBe(b);
    const first = sessions.get(a).prompt(text("alpha"));
    const second = sessions.get(b).prompt(text("beta"));
    await vi.waitFor(() => expect(models.every((model) => model.requests.length === 1)).toBe(true));
    await expect(sessions.get(a).prompt(text("overlap"))).rejects.toMatchObject({
      kind: "session_busy",
    });
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(["end_turn", "end_turn"]);
    await sessions.get(a).prompt(text("followup"));
    const alpha = models.find((model) => JSON.stringify(model.requests[0]).includes("alpha"))!;
    const beta = models.find((model) => JSON.stringify(model.requests[0]).includes("beta"))!;
    expect(alpha.requests[1]!.chatHistory.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(alpha.requests[1])).toContain("alpha");
    expect(JSON.stringify(alpha.requests)).not.toContain("beta");
    expect(beta.requests).toHaveLength(1);
    const memory = sessions.get(a).memory;
    const history = await memory.load({ scope: { sessionId: a } });
    expect(history).toHaveLength(4);
    history.pop();
    expect(await memory.load({ scope: { sessionId: a } })).toHaveLength(4);
    await sessions.get(a).prompt(text("third"));
    expect(alpha.requests[2]!.chatHistory).toHaveLength(5);
    expect(JSON.stringify(alpha.requests[2])).toContain("followup");
    await expect(memory.load({ scope: { sessionId: b } })).rejects.toMatchObject({
      kind: "session_not_found",
    });
    expect(contexts.map((context) => context.cwd).sort()).toEqual([
      join(root, "a"),
      join(root, "b"),
    ]);
    expect(contexts.every((context) => Object.isFrozen(context.policy.editorTools))).toBe(true);
    expect(process.cwd()).toBe(originalCwd);
  });

  it("consumes a streaming model once and remembers its completed output", async () => {
    const requests: string[] = [];
    const model: StreamingCompletionModel = {
      ...makeAgent().model,
      capabilities: { ...makeAgent().model.capabilities, streaming: true },
      async *streamCompletion(request) {
        requests.push(JSON.stringify(request));
        yield { type: "text_delta", delta: "streamed" };
        yield {
          type: "final",
          response: {
            choice: [{ type: "text", text: "streamed" }],
            usage: Usage.empty(),
            rawResponse: {},
          },
        };
      },
    };
    const sessions = manager({
      sessionFactory: () => ({ agent: new Agent({ id: "stream", model }) }),
    });
    const id = await sessions.create(root, capabilities);
    await sessions.get(id).prompt(text("one"));
    await sessions.get(id).prompt(text("two"));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("streamed");
  });

  it("clears the prompt lock after failure without retaining the failed turn", async () => {
    let fail = true;
    const model = makeAgent(async () => {
      if (fail) throw new Error("private-provider-credential");
    });
    const sessions = manager({ sessionFactory: () => model });
    const id = await sessions.create(root, capabilities);
    await expect(sessions.get(id).prompt(text("failed"))).rejects.toMatchObject({
      kind: "execution_failed",
    });
    fail = false;
    await expect(sessions.get(id).prompt(text("retry"))).resolves.toBe("end_turn");
    expect(JSON.stringify(model.requests[1])).not.toContain("failed");
  });

  it("bounds completed history atomically and rejects a full history before model execution", async () => {
    const model = makeAgent();
    const sessions = manager({ sessionFactory: () => model, limits: { maxHistoryMessages: 2 } });
    const id = await sessions.create(root, capabilities);
    await sessions.get(id).prompt(text("one"));
    await expect(sessions.get(id).prompt(text("two"))).rejects.toMatchObject({
      kind: "resource_limit",
    });
    expect(model.requests).toHaveLength(1);
    expect(await sessions.get(id).memory.load({ scope: { sessionId: id } })).toHaveLength(2);
    const small = manager({ limits: { maxHistoryBytes: 80 } });
    const smallId = await small.create(root, capabilities);
    await expect(small.get(smallId).prompt(text("one"))).rejects.toMatchObject({
      kind: "resource_limit",
    });
    expect(await small.get(smallId).memory.load({ scope: { sessionId: smallId } })).toEqual([]);
  });

  it("reserves capacity during factory setup and releases it after failure", async () => {
    const gate = deferred();
    const started = deferred();
    const factory = vi.fn(async () => {
      started.resolve();
      await gate.promise;
      return makeAgent();
    });
    const sessions = manager({ sessionFactory: factory, limits: { maxSessions: 1 } });
    const pending = sessions.create(root, capabilities);
    await started.promise;
    await expect(sessions.create(root, capabilities)).rejects.toMatchObject({
      kind: "resource_limit",
    });
    gate.reject(new Error("setup failure"));
    await expect(pending).rejects.toMatchObject({ kind: "configuration_error" });
    factory.mockImplementationOnce(async () => makeAgent());
    await expect(sessions.create(root, capabilities)).resolves.toEqual(expect.any(String));
    await expect(sessions.create(root, capabilities)).rejects.toMatchObject({
      kind: "resource_limit",
    });
  });

  it("rejects relative, missing and file cwd plus symlink escapes before calling the factory", async () => {
    await mkdir(join(root, "allowed"));
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "allowed", "escape"));
    await writeFile(join(root, "file"), "fixture");
    const factory = vi.fn(() => makeAgent());
    const sessions = manager({ sessionFactory: factory, workspaceRoots: [join(root, "allowed")] });
    for (const cwd of [".", join(root, "missing"), join(root, "file")]) {
      await expect(sessions.create(cwd, capabilities)).rejects.toMatchObject({
        kind: "invalid_cwd",
      });
    }
    for (const cwd of [join(root, "outside"), join(root, "allowed", "escape")]) {
      await expect(sessions.create(cwd, capabilities)).rejects.toMatchObject({
        kind: "policy_denied",
      });
    }
    expect(factory).not.toHaveBeenCalled();
    await sessions.create(join(root, "allowed"), capabilities);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("rejects shared agents and independently configured memory", async () => {
    const binding = { ...makeAgent(), dispose: vi.fn() };
    const sessions = manager({ sessionFactory: () => binding });
    await sessions.create(root, capabilities);
    await expect(sessions.create(root, capabilities)).rejects.toMatchObject({
      kind: "configuration_error",
    });
    expect(binding.dispose).not.toHaveBeenCalled();
    const dispose = vi.fn();
    const other = manager({
      sessionFactory: () => ({
        agent: new Agent({
          id: "memory",
          model: makeAgent().model,
          memory: {
            store: { load: async () => [], append: async () => {}, clear: async () => {} },
          },
        }),
        dispose,
      }),
    });
    await expect(other.create(root, capabilities)).rejects.toMatchObject({
      kind: "configuration_error",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("aborts setup and disposes a late factory binding exactly once", async () => {
    const gate = deferred();
    const started = deferred();
    const dispose = vi.fn();
    let context!: AcpSessionContext;
    const sessions = manager({
      sessionFactory: async (value) => {
        context = value;
        started.resolve();
        await gate.promise;
        return { ...makeAgent(), dispose };
      },
    });
    const pending = sessions.create(root, capabilities);
    await started.promise;
    const closing = sessions.close();
    expect(context.signal.aborted).toBe(true);
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ kind: "connection_closed" });
    await closing;
    await sessions.close();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cleans all sessions even when one disposer throws", async () => {
    const dispose = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const sessions = manager({ sessionFactory: () => ({ ...makeAgent(), dispose }) });
    const a = await sessions.create(root, capabilities);
    const b = await sessions.create(root, capabilities);
    const contexts = [sessions.get(a).context, sessions.get(b).context];
    await sessions.close();
    await sessions.close();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(contexts.every((context) => context.signal.aborted)).toBe(true);
  });
});

describe("session v1 wire boundary", () => {
  it("requires initialization and snapshots client capabilities with tools disabled", async () => {
    let context!: AcpSessionContext;
    const fixture = wireFixture({
      sessionFactory(value) {
        context = value;
        return makeAgent();
      },
    });
    cleanup.push(() => fixture.connection.close());
    expect(
      (await fixture.request("session/new", { cwd: root, mcpServers: [] })).error?.data?.kind,
    ).toBe("not_initialized");
    expect(
      (await fixture.request("session/prompt", { sessionId: "unknown", prompt: text("hi") })).error
        ?.data?.kind,
    ).toBe("not_initialized");
    await fixture.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true }, terminal: true, elicitation: { form: {} } },
    });
    const created = await fixture.request("session/new", { cwd: root, mcpServers: [] });
    expect(created.result?.sessionId).toBe(context.sessionId);
    expect(context.clientCapabilities).toEqual({
      readTextFile: true,
      writeTextFile: false,
      terminal: true,
      elicitationForm: true,
    });
    expect(context.policy.editorTools).toEqual({
      readTextFile: false,
      writeTextFile: false,
      terminal: false,
    });
    expect(context.mcpServers).toEqual([]);
    expect(context.editorTools).toEqual([]);
  });

  it("runs two turns, rejects unknown sessions, and sanitizes execution errors", async () => {
    let fail = false;
    const model = makeAgent(async () => {
      if (fail) throw new Error("private-provider-credential");
    });
    const fixture = await peer({ sessionFactory: () => model });
    const sessionId = (await fixture.request("session/new", { cwd: root, mcpServers: [] })).result!
      .sessionId!;
    for (const prompt of ["hello", "again"]) {
      expect(
        (await fixture.request("session/prompt", { sessionId, prompt: text(prompt) })).result,
      ).toEqual({ stopReason: "end_turn" });
    }
    expect(model.requests[1]!.chatHistory).toHaveLength(3);
    expect(
      (await fixture.request("session/prompt", { sessionId: "unknown", prompt: text("hi") })).error,
    ).toEqual({ code: -32002, message: "Request failed", data: { kind: "session_not_found" } });
    fail = true;
    const failed = await fixture.request("session/prompt", {
      sessionId,
      prompt: text("secret-input"),
    });
    expect(failed.error?.data?.kind).toBe("execution_failed");
    expect(JSON.stringify(failed)).not.toMatch(/secret-input|private-provider/);
  });

  it("rejects overlapping wire prompts instead of queueing them", async () => {
    const gate = deferred();
    const model = makeAgent(() => gate.promise);
    const fixture = await peer({ sessionFactory: () => model });
    const sessionId = (await fixture.request("session/new", { cwd: root, mcpServers: [] })).result!
      .sessionId!;
    const first = fixture.request("session/prompt", { sessionId, prompt: text("first") });
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    const second = await fixture.request("session/prompt", { sessionId, prompt: text("second") });
    gate.resolve();
    expect(second.error).toMatchObject({ code: -32600, data: { kind: "session_busy" } });
    expect((await first).result?.stopReason).toBe("end_turn");
    expect(model.requests).toHaveLength(1);
  });

  it("rejects MCP declarations before the factory until ACP 07", async () => {
    const factory = vi.fn(() => makeAgent());
    const fixture = await peer({ sessionFactory: factory });
    expect(
      (
        await fixture.request("session/new", {
          cwd: root,
          mcpServers: [{ name: "server", command: "untrusted", args: [], env: [] }],
        })
      ).error?.data?.kind,
    ).toBe("unsupported_mcp");
    expect(factory).not.toHaveBeenCalled();
  });

  it("aborts active work on EOF and waits for binding cleanup", async () => {
    const started = deferred();
    const dispose = vi.fn();
    let context!: AcpSessionContext;
    const fixture = await peer({
      sessionFactory(value) {
        context = value;
        return {
          ...makeAgent(async () => {
            started.resolve();
            await new Promise<void>((resolve) =>
              value.signal.addEventListener("abort", () => resolve(), { once: true }),
            );
          }),
          dispose,
        };
      },
    });
    const sessionId = (await fixture.request("session/new", { cwd: root, mcpServers: [] })).result!
      .sessionId!;
    fixture.input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "active",
        method: "session/prompt",
        params: { sessionId, prompt: text("hello") },
      }) + "\n",
    );
    await started.promise;
    fixture.input.end();
    await fixture.connection.closed;
    expect(context.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
