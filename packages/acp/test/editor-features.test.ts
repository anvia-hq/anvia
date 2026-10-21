import { Agent } from "@anvia/core/agent";
import { Usage, type CompletionRequest, type ToolCallPart } from "@anvia/core/completion";
import type { AnyTool } from "@anvia/core/tool";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorTools, editorPresentation, type EditorClient } from "../src/editor-tools.js";
import { PendingRequests } from "../src/pending-requests.js";
import { mapSandboxPath, presentTool } from "../src/presentation.js";
import { SessionManager } from "../src/session-manager.js";
import type { AcpOptions, AcpSessionContext } from "../src/types.js";
import { deferred, makeAgent, wireFixture } from "./helpers.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const capabilities = {
  readTextFile: true,
  writeTextFile: true,
  terminal: true,
  elicitationForm: false,
};
const textPrompt = [{ type: "text" as const, text: "go" }];
const editorOptions = { readTextFile: true, writeTextFile: true, terminal: true };

async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "acp-editor-")));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function editor(): EditorClient {
  return {
    read: vi.fn(async () => "unsaved text"),
    write: vi.fn(async () => {}),
    create: vi.fn(async () => "terminal-1"),
    wait: vi.fn(async () => ({ exitCode: 0, signal: null })),
    output: vi.fn(async () => ({ output: "done", truncated: false })),
    kill: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
}
function manager(options: AcpOptions) {
  const sessions = new SessionManager(options);
  cleanups.push(() => sessions.close());
  return sessions;
}
async function toolsFixture(client = editor()) {
  const cwd = await directory();
  const pending = new PendingRequests(16);
  const tools = createEditorTools(
    cwd,
    { permissionPreset: "ask", workspaceRoots: [cwd], editorTools: editorOptions },
    client,
    () => pending,
  );
  return {
    cwd,
    client,
    pending,
    tools,
    call: (name: string, args: unknown) =>
      Promise.resolve(tools.find((tool) => tool.name === name)!.call(args)),
  };
}

function factory(context: AcpSessionContext) {
  return {
    agent: new Agent({
      id: "editor",
      model: makeAgent().model,
      tools: context.editorTools,
      mcpServers: context.mcpServers,
    }),
  };
}

describe("editor backends", () => {
  it("intersects explicit opt-in and each client capability; validates attached identities", async () => {
    const cwd = await directory();
    const contexts: AcpSessionContext[] = [];
    for (const [options, caps, names] of [
      [{}, capabilities, []],
      [
        { editorTools: editorOptions },
        { ...capabilities, writeTextFile: false, terminal: false },
        ["editor_read_text_file"],
      ],
      [
        { editorTools: editorOptions },
        capabilities,
        ["editor_read_text_file", "editor_write_text_file", "editor_run_terminal"],
      ],
    ] as const) {
      const sessions = manager({
        ...options,
        sessionFactory: (context) => {
          contexts.push(context);
          return factory(context);
        },
      });
      await sessions.create(cwd, caps, [], () => editor());
      expect(contexts.at(-1)!.editorTools.map((tool) => tool.name)).toEqual(names);
      expect(contexts.at(-1)!.editorTools.every((tool) => tool.requiresApproval === true)).toBe(
        true,
      );
    }
    const invalid = manager({
      editorTools: editorOptions,
      sessionFactory: () => ({ agent: makeAgent().agent }),
    });
    await expect(invalid.create(cwd, capabilities, [], () => editor())).rejects.toMatchObject({
      kind: "configuration_error",
    });
  });

  it("uses session paths and editor buffers; refuses traversal, symlink escape and malformed input", async () => {
    const fixture = await toolsFixture();
    expect(await fixture.call("editor_read_text_file", { path: "new.txt" })).toBe("unsaved text");
    expect(fixture.client.read).toHaveBeenCalledWith(
      join(fixture.cwd, "new.txt"),
      expect.any(AbortSignal),
    );
    const outside = await directory();
    await symlink(outside, join(fixture.cwd, "escape"));
    await symlink(join(outside, "missing"), join(fixture.cwd, "dangling"));
    for (const path of ["../outside", "escape/new.txt", "dangling/new.txt", "bad\0path"]) {
      await expect(
        fixture.call("editor_write_text_file", { path, content: "no" }),
      ).rejects.toBeDefined();
    }
    await expect(
      fixture.call("editor_write_text_file", { path: "file", content: 5 }),
    ).rejects.toMatchObject({ kind: "invalid_content" });
    expect(fixture.client.write).not.toHaveBeenCalled();
  });

  it("propagates editor denial without writing locally or trying another backend", async () => {
    const client = editor();
    client.write = vi.fn(async () => {
      throw new Error("denied");
    });
    const fixture = await toolsFixture(client);
    await expect(
      fixture.call("editor_write_text_file", { path: "file", content: "no" }),
    ).rejects.toThrow("denied");
    await expect(realpath(join(fixture.cwd, "file"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.create).not.toHaveBeenCalled();
  });

  it("releases a terminal after success and every failure, even when kill fails", async () => {
    const fixture = await toolsFixture();
    await expect(
      fixture.call("editor_run_terminal", { command: "echo", args: ["hello"] }),
    ).resolves.toEqual({
      output: "done",
      truncated: false,
      exitStatus: { exitCode: 0, signal: null },
    });
    expect(fixture.client.create).toHaveBeenCalledWith("echo", ["hello"], fixture.cwd, 1024 * 1024);
    expect(fixture.client.release).toHaveBeenCalledTimes(1);
    expect(fixture.client.kill).not.toHaveBeenCalled();
    fixture.client.wait = vi.fn(async () => {
      throw new Error("wait failed");
    });
    fixture.client.kill = vi.fn(async () => {
      throw new Error("kill failed");
    });
    await expect(fixture.call("editor_run_terminal", { command: "false" })).rejects.toThrow();
    expect(fixture.client.release).toHaveBeenCalledTimes(2);
  });

  it.each(["create", "wait"])(
    "kills and releases on cancellation during %s, including late terminal IDs",
    async (stage) => {
      const client = editor();
      const created = deferred<string>();
      const waiting = deferred();
      if (stage === "create") client.create = vi.fn(() => created.promise);
      client.wait = vi.fn((_id, signal) => {
        waiting.resolve();
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      });
      const fixture = await toolsFixture(client);
      const call = fixture.call("editor_run_terminal", { command: "long-running" });
      const rejected = expect(call).rejects.toBeDefined();
      await vi.waitFor(() => expect(client.create).toHaveBeenCalled());
      if (stage === "wait") await waiting.promise;
      fixture.pending.close();
      created.resolve("late-id");
      await rejected;
      expect(client.kill).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(vi.mocked(client.release).mock.calls[0]![1].aborted).toBe(false);
      if (stage === "create") expect(client.wait).not.toHaveBeenCalled();
    },
  );
});

describe("session configuration", () => {
  it("disposes a replacement returned after disconnect without publishing it", async () => {
    const started = deferred();
    const finish = deferred();
    const oldDispose = vi.fn();
    const newDispose = vi.fn();
    const sessions = manager({
      models: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
      ],
      sessionFactory: async (context) => {
        if (context.config.model === "b") {
          started.resolve();
          await finish.promise;
          return { agent: makeAgent().agent, dispose: newDispose };
        }
        return { agent: makeAgent().agent, dispose: oldDispose };
      },
    });
    const session = sessions.get(await sessions.create(await directory(), capabilities));
    const switching = session.setConfig("model", "b");
    const rejected = expect(switching).rejects.toMatchObject({ kind: "connection_closed" });
    await started.promise;
    const closing = sessions.close();
    finish.resolve();
    await rejected;
    await closing;
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(newDispose).toHaveBeenCalledTimes(1);
    expect(session.context.config.model).toBe("a");
  });

  it("rebuilds the capability intersection for read-only mode without enabling disabled tools", async () => {
    const sessions = manager({
      readOnlyMode: true,
      editorTools: editorOptions,
      sessionFactory: factory,
    });
    const session = sessions.get(
      await sessions.create(await directory(), { ...capabilities, terminal: false }, [], () =>
        editor(),
      ),
    );
    await session.setConfig("mode", "read-only");
    expect(session.context.editorTools.map((tool) => tool.name)).toEqual(["editor_read_text_file"]);
    expect(session.context.policy.editorTools).toEqual({
      readTextFile: true,
      writeTextFile: false,
      terminal: false,
    });
    await session.setConfig("mode", "ask");
    expect(session.context.editorTools.map((tool) => tool.name)).toEqual([
      "editor_read_text_file",
      "editor_write_text_file",
    ]);
  });

  it("rebuilds with preserved history and isolated config, rolls back factory failures, and disposes bindings once", async () => {
    const cwd = await directory();
    const contexts: AcpSessionContext[] = [];
    const requests: CompletionRequest[] = [];
    const disposers: ReturnType<typeof vi.fn>[] = [];
    const sessions = manager({
      models: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
        { value: "bad", name: "Bad" },
      ],
      sessionFactory: (context) => {
        if (context.config.model === "bad") throw new Error("secret config");
        contexts.push(context);
        const dispose = vi.fn();
        disposers.push(dispose);
        return {
          agent: makeAgent(async (request) => {
            requests.push(request);
          }).agent,
          dispose,
        };
      },
    });
    const id = await sessions.create(cwd, capabilities);
    const other = await sessions.create(cwd, capabilities);
    const session = sessions.get(id);
    await session.prompt(textPrompt);
    await session.setConfig("model", "b");
    await session.prompt(textPrompt);
    expect(requests.at(-1)!.chatHistory.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(session.context.config.model).toBe("b");
    expect(sessions.get(other).context.config.model).toBe("a");
    await expect(session.setConfig("model", "bad")).rejects.toMatchObject({
      kind: "configuration_error",
    });
    expect(session.context.config.model).toBe("b");
    await expect(session.setConfig("model", "unknown")).rejects.toMatchObject({
      kind: "invalid_config",
    });
    expect(contexts).toHaveLength(3);
    await sessions.close();
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("cancels a pending approval before switching, ignores late approval, and uses read-only tools", async () => {
    const cwd = await directory();
    const approval = deferred<"allow">();
    const asked = deferred();
    const execute = vi.fn(() => "executed");
    const tool: AnyTool = {
      name: "write",
      requiresApproval: true,
      call: execute,
      definition: () => ({ name: "write", description: "write", parameters: { type: "object" } }),
    };
    const sessions = manager({
      readOnlyMode: true,
      sessionFactory: (context) => {
        const model = makeAgent().model;
        model.completion = async () => ({
          choice: [{ type: "tool-call", toolCallId: "1", toolName: "write", input: {} }],
          usage: Usage.empty(),
          rawResponse: {},
        });
        return {
          agent: new Agent({
            id: "switch",
            model,
            tools: context.config.mode === "ask" ? [tool] : [],
          }),
        };
      },
    });
    const session = sessions.get(await sessions.create(cwd, capabilities));
    const prompt = session.prompt(textPrompt, undefined, {
      permission: async () => {
        asked.resolve();
        return approval.promise;
      },
      question: async () => "cancel",
    });
    await asked.promise;
    await session.setConfig("mode", "read-only");
    approval.resolve("allow");
    expect(await prompt).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    expect(session.context.policy.permissionPreset).toBe("read-only");
    expect(await session.memory.load({ scope: { sessionId: session.context.sessionId } })).toEqual(
      [],
    );
  });

  it("rejects unclassified read-only tools without committing the new mode", async () => {
    const sessions = manager({
      readOnlyMode: true,
      sessionFactory: () => ({
        agent: new Agent({
          id: "bad-read",
          model: makeAgent().model,
          tools: [
            {
              name: "unknown",
              definition: () => ({ name: "unknown", description: "unknown", parameters: {} }),
              call: () => "effect",
            },
          ],
        }),
      }),
    });
    const session = sessions.get(await sessions.create(await directory(), capabilities));
    await expect(session.setConfig("mode", "read-only")).rejects.toMatchObject({
      kind: "configuration_error",
    });
    expect(session.context.config.mode).toBe("ask");
  });

  it("quarantines an uncooperative run through rebuild and blocks overlapping prompts/config changes", async () => {
    const running = deferred();
    const finish = deferred();
    let count = 0;
    const sessions = manager({
      models: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
      ],
      sessionFactory: () => {
        count++;
        return {
          agent: makeAgent(async () => {
            running.resolve();
            await finish.promise;
          }).agent,
        };
      },
    });
    const session = sessions.get(await sessions.create(await directory(), capabilities));
    const prompt = session.prompt(textPrompt);
    await running.promise;
    const switching = session.setConfig("model", "b");
    expect(await prompt).toBe("cancelled");
    await expect(session.prompt(textPrompt)).rejects.toMatchObject({ kind: "session_busy" });
    await expect(session.setConfig("model", "a")).rejects.toMatchObject({ kind: "session_busy" });
    expect(count).toBe(1);
    finish.resolve();
    await switching;
    expect(count).toBe(2);
  });
});

describe("presentation and wire features", () => {
  it("sanitizes terminal command, argument and cwd controls without truncating short titles", async () => {
    const fixture = await toolsFixture();
    const metadata = editorPresentation(
      {
        type: "tool-call",
        toolCallId: "terminal",
        toolName: "editor_run_terminal",
        input: { command: "ec\u0085ho", args: ["a\nb"], cwd: "bad\tpath" },
      },
      fixture.tools,
      fixture.cwd,
    );
    expect(presentTool("editor_run_terminal", fixture.cwd, metadata)).toEqual({
      title: 'Run: "ec ho" "a b"',
      kind: "execute",
      text: `Command: "ec ho" "a b" | cwd: ${join(fixture.cwd, "bad path")}`,
      locations: [],
    });
  });

  it.each([{ command: 42 }, { command: "echo", args: "hello" }, { command: "echo", args: [null] }])(
    "falls back safely for malformed terminal input %j",
    async (input) => {
      const fixture = await toolsFixture();
      expect(
        editorPresentation(
          { type: "tool-call", toolCallId: "terminal", toolName: "editor_run_terminal", input },
          fixture.tools,
          fixture.cwd,
        ),
      ).toEqual({ title: "Run editor terminal", kind: "execute" });
    },
  );

  it.each([undefined, "subdir/../target", "/absolute/target"])(
    "shows the full sanitized terminal command and resolved cwd (%s) in permission requests",
    async (targetCwd) => {
      const cwd = await directory();
      const args = ["hello world", 'say "hi"', "it's", "", "a\\b", "x".repeat(220)];
      const commandLine = `echo ${args.map((arg) => (/^[a-z]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ")}`;
      const path =
        targetCwd === undefined ? cwd : targetCwd.startsWith("/") ? targetCwd : join(cwd, "target");
      const input: Record<string, string | string[]> = {
        command: "echo",
        args: ["hello\tworld", ...args.slice(1)],
      };
      if (targetCwd !== undefined) input.cwd = targetCwd;
      const call: ToolCallPart = {
        type: "tool-call",
        toolCallId: "terminal",
        toolName: "editor_run_terminal",
        input,
      };
      let turn = 0;
      const fixture = wireFixture({
        editorTools: { terminal: true },
        sessionFactory: (context) => {
          const model = makeAgent().model;
          model.completion = async () => ({
            choice: turn++ === 0 ? [call] : [{ type: "text", text: "done" }],
            usage: Usage.empty(),
            rawResponse: {},
          });
          return { agent: new Agent({ id: "terminal", model, tools: context.editorTools }) };
        },
      });
      cleanups.push(() => fixture.connection.close());
      await fixture.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { terminal: true },
      });
      const sessionId = (await fixture.request("session/new", { cwd, mcpServers: [] })).result!
        .sessionId!;
      const prompt = fixture.request("session/prompt", { sessionId, prompt: textPrompt });
      await vi.waitFor(() =>
        expect(fixture.responses.some((r) => r.method === "session/request_permission")).toBe(true),
      );
      const permission = fixture.responses.find((r) => r.method === "session/request_permission")!;
      expect(permission.params).toMatchObject({
        toolCall: {
          title: `${`Run: ${commandLine}`.slice(0, 199)}…`,
          kind: "execute",
          locations: [{ path }],
          content: [
            {
              type: "content",
              content: { type: "text", text: `Command: ${commandLine} | cwd: ${path}` },
            },
          ],
        },
      });
      fixture.input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: permission.id,
          result: { outcome: { outcome: "selected", optionId: "reject_once" } },
        }) + "\n",
      );
      expect((await prompt).result?.stopReason).toBe("end_turn");
      expect(fixture.responses.some((r) => r.method === "terminal/create")).toBe(false);
    },
  );

  it("maps only explicitly mounted Docker paths and limits proposed diffs", () => {
    const mapping = { sandboxRoot: "/workspace", hostRoot: "/host/project" };
    expect(mapSandboxPath("src/a.ts", mapping)).toBe("/host/project/src/a.ts");
    expect(mapSandboxPath("/workspace/src/a.ts", mapping)).toBe("/host/project/src/a.ts");
    expect(() => mapSandboxPath("../secret", mapping)).toThrow();
    expect(() => mapSandboxPath("/workspace-other/a", mapping)).toThrow();
    expect(presentTool("unknown", "/cwd")).toEqual({
      title: "unknown",
      kind: "other",
      locations: [],
    });
    expect(
      presentTool("edit", "/cwd", {
        diffs: [
          { path: "file", oldText: "before", newText: "after" },
          { path: "bad\0", newText: "no" },
        ],
      }).diffs,
    ).toEqual([{ path: "/cwd/file", oldText: "before", newText: "after" }]);
  });

  it("advertises commands, expands prompts, accepts images/text resources, rejects blobs, and updates config", async () => {
    const requests: CompletionRequest[] = [];
    const fixture = wireFixture({
      images: true,
      embeddedContext: true,
      models: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
      ],
      commands: [
        {
          name: "explain",
          description: "Explain code",
          inputHint: "topic",
          expand: (args) => `Explain ${args}`,
        },
      ],
      sessionFactory: () => ({
        agent: makeAgent(async (request) => {
          requests.push(request);
        }).agent,
      }),
    });
    cleanups.push(() => fixture.connection.close());
    const initialized = await fixture.request("initialize", { protocolVersion: 1 });
    expect(initialized.result?.agentCapabilities).toMatchObject({
      promptCapabilities: { image: true, embeddedContext: true },
    });
    const created = await fixture.request("session/new", {
      cwd: await directory(),
      mcpServers: [],
    });
    const sessionId = created.result!.sessionId!;
    expect(created.result).toMatchObject({
      configOptions: [{ id: "mode" }, { id: "model", currentValue: "a" }],
    });
    expect(
      fixture.responses.some(
        (response) => response.params?.update.sessionUpdate === "available_commands_update",
      ),
    ).toBe(true);
    expect(
      (
        await fixture.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "/explain loops" }],
        })
      ).result?.stopReason,
    ).toBe("end_turn");
    expect(JSON.stringify(requests.at(-1))).toContain("Explain loops");
    expect(
      (
        await fixture.request("session/prompt", {
          sessionId,
          prompt: [
            {
              type: "resource",
              resource: { uri: "file:///not-read", text: "context body", mimeType: "text/plain" },
            },
            { type: "image", data: "aGk=", mimeType: "image/png" },
          ],
        })
      ).result?.stopReason,
    ).toBe("end_turn");
    expect(JSON.stringify(requests.at(-1))).toContain("context body");
    expect(
      (
        await fixture.request("session/prompt", {
          sessionId,
          prompt: [{ type: "resource", resource: { uri: "file:///blob", blob: "aGk=" } }],
        })
      ).error?.data?.kind,
    ).toBe("unsupported_content");
    expect(
      (
        await fixture.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: "b",
        })
      ).result,
    ).toMatchObject({ configOptions: [{ id: "mode" }, { id: "model", currentValue: "b" }] });
    expect(
      fixture.responses.some(
        (response) => response.params?.update.sessionUpdate === "config_option_update",
      ),
    ).toBe(true);
  });

  it.each([true, false])(
    "shows a proposed editor diff and executes only on allow=%s",
    async (allow) => {
      const cwd = await directory();
      let turn = 0;
      const call: ToolCallPart = {
        type: "tool-call",
        toolCallId: "write-1",
        toolName: "editor_write_text_file",
        input: { path: "file.txt", content: "new text" },
      };
      const fixture = wireFixture({
        editorTools: { writeTextFile: true },
        sessionFactory: (context) => {
          const model = makeAgent().model;
          model.completion = async () => ({
            choice: turn++ === 0 ? [call] : [{ type: "text", text: "done" }],
            usage: Usage.empty(),
            rawResponse: {},
          });
          return { agent: new Agent({ id: "write", model, tools: context.editorTools }) };
        },
      });
      cleanups.push(() => fixture.connection.close());
      await fixture.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { writeTextFile: true } },
      });
      const sessionId = (await fixture.request("session/new", { cwd, mcpServers: [] })).result!
        .sessionId!;
      const prompt = fixture.request("session/prompt", { sessionId, prompt: textPrompt });
      await vi.waitFor(() =>
        expect(fixture.responses.some((r) => r.method === "session/request_permission")).toBe(true),
      );
      const permission = fixture.responses.find((r) => r.method === "session/request_permission")!;
      expect(permission.params).toMatchObject({
        toolCall: {
          kind: "edit",
          locations: [{ path: join(cwd, "file.txt") }],
          content: [{ type: "diff", path: join(cwd, "file.txt"), newText: "new text" }],
        },
      });
      fixture.input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: permission.id,
          result: {
            outcome: { outcome: "selected", optionId: allow ? "allow_once" : "reject_once" },
          },
        }) + "\n",
      );
      if (allow) {
        await vi.waitFor(() =>
          expect(fixture.responses.some((r) => r.method === "fs/write_text_file")).toBe(true),
        );
        const write = fixture.responses.find((r) => r.method === "fs/write_text_file")!;
        expect(write.params).toMatchObject({ path: join(cwd, "file.txt"), content: "new text" });
        fixture.input.write(JSON.stringify({ jsonrpc: "2.0", id: write.id, result: {} }) + "\n");
      }
      expect((await prompt).result?.stopReason).toBe("end_turn");
      expect(fixture.responses.filter((r) => r.method === "fs/write_text_file")).toHaveLength(
        allow ? 1 : 0,
      );
    },
  );
});
