import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stdioClient, type Frame } from "./stdio-client.js";

let root: string;
let peer: ReturnType<typeof stdioClient>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp-stdio-")));
  peer = stdioClient();
});
afterEach(async () => {
  try {
    await peer.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const prompt = (sessionId: string, text: string) => ({
  sessionId,
  prompt: [{ type: "text", text }],
});
const permission = (frame: Frame) => frame.method === "session/request_permission";
const allow = { outcome: { outcome: "selected", optionId: "allow_once" } };
function updates(sessionId: string, after = 0) {
  return peer.frames
    .slice(after)
    .filter((frame) => frame.method === "session/update" && frame.params?.sessionId === sessionId)
    .map((frame) => (frame.params as unknown as SessionNotification).update);
}
function output(sessionId: string, after = 0) {
  return updates(sessionId, after)
    .flatMap((update) =>
      update.sessionUpdate === "agent_message_chunk" && update.content.type === "text"
        ? [update.content.text]
        : [],
    )
    .join("");
}
async function session(cwd = root) {
  const response = await peer.request("session/new", { cwd, mcpServers: [] });
  expect(response.error).toBeUndefined();
  return (response.result as { sessionId: string }).sessionId;
}
async function initialize(version = 1) {
  expect(await peer.request("initialize", { protocolVersion: version })).toMatchObject({
    result: { protocolVersion: 1, authMethods: [] },
  });
}

describe("real stdio conversations", () => {
  it("negotiates an unsupported version and recovers from invalid params and unknown methods", async () => {
    expect(await peer.request("initialize", { protocolVersion: "invalid" })).toMatchObject({
      error: { code: -32602 },
    });
    await initialize(999);
    expect(await peer.request("unknown/method", {})).toMatchObject({ error: { code: -32601 } });
    expect(await peer.request("session/new", { cwd: root })).toMatchObject({
      error: { code: -32602 },
    });
    const id = await session();
    expect(
      await peer.request("session/prompt", { sessionId: id, prompt: "invalid" }),
    ).toMatchObject({ error: { code: -32602 } });
    expect(await peer.request("session/prompt", prompt(id, "healthy"))).toMatchObject({
      result: { stopReason: "end_turn" },
    });
  });

  it("isolates workspaces and histories and orders all chunks before one final response", async () => {
    await initialize();
    await Promise.all([mkdir(join(root, "a")), mkdir(join(root, "b"))]);
    const [a, b] = await Promise.all([session(join(root, "a")), session(join(root, "b"))]);
    expect(a).not.toBe(b);
    await Promise.all([
      peer.request("session/prompt", prompt(a, "alpha")),
      peer.request("session/prompt", prompt(b, "beta")),
    ]);
    const after = peer.frames.length;
    const turn = peer.start("session/prompt", prompt(a, "followup"));
    expect(await turn.response).toMatchObject({ result: { stopReason: "end_turn" } });
    expect(JSON.parse(output(a, after))).toEqual({
      cwd: join(root, "a"),
      users: [[{ type: "text", text: "alpha" }], [{ type: "text", text: "followup" }]],
      executions: 0,
    });
    expect(JSON.parse(output(b))).toMatchObject({
      cwd: join(root, "b"),
      users: [[{ type: "text", text: "beta" }]],
    });
    const frames = peer.frames.slice(after);
    expect(frames.map((frame) => frame.method ?? frame.id)).toEqual([
      "session/update",
      "session/update",
      turn.id,
    ]);
    expect(peer.stderr()).toContain("fixture imported");
    expect(peer.stderr()).toContain("fixture direct write");
    expect(peer.stderr()).toContain("fixture generation");
  });

  it("preserves IDs across approval continuations and allocates new IDs for reused provider IDs", async () => {
    await initialize();
    const id = await session();
    const ids: string[] = [];
    for (let turn = 0; turn < 2; turn++) {
      const after = peer.frames.length;
      const pending = peer.start("session/prompt", prompt(id, "fixture:tools"));
      let cursor = after;
      for (let call = 0; call < 2; call++) {
        const request = await peer.waitFor(permission, cursor);
        cursor = peer.frames.indexOf(request) + 1;
        const params = request.params as unknown as RequestPermissionRequest;
        ids.push(params.toolCall.toolCallId);
        expect(peer.frames.some((frame) => frame.id === pending.id)).toBe(false);
        expect(updates(id, after)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "tool_call", toolCallId: ids.at(-1) }),
        );
        peer.reply(request, allow);
      }
      expect(await pending.response).toMatchObject({ result: { stopReason: "end_turn" } });
      const completed = updates(id, after).filter(
        (update) => update.sessionUpdate === "tool_call_update" && update.status === "completed",
      );
      expect(completed).toEqual(
        ids.slice(-2).map((toolCallId) => ({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
        })),
      );
      expect(JSON.parse(output(id, after)).executions).toBe((turn + 1) * 2);
    }
    expect(new Set(ids).size).toBe(4);
    expect(peer.stderr().match(/fixture tool executed/g)).toHaveLength(4);
  });

  it.each([
    { outcome: { outcome: "selected", optionId: "reject_once" } },
    { outcome: { outcome: "selected", optionId: "allow_always" } },
    { outcome: { outcome: "selected", optionId: 7 } },
    {},
  ])("does not execute denied or malformed selections: %j", async (reply) => {
    await initialize();
    const id = await session();
    const pending = peer.start("session/prompt", prompt(id, "fixture:tools"));
    let cursor = 0;
    for (let call = 0; call < 2; call++) {
      const request = await peer.waitFor(permission, cursor);
      cursor = peer.frames.indexOf(request) + 1;
      peer.reply(request, reply);
    }
    expect(await pending.response).toMatchObject({ result: { stopReason: "end_turn" } });
    expect(JSON.parse(output(id)).executions).toBe(0);
    expect(
      updates(id)
        .filter((update) => update.sessionUpdate === "tool_call_update")
        .map((update) => update.status),
    ).toEqual(["pending", "failed", "pending", "failed"]);
    expect(peer.stderr()).not.toContain("fixture tool executed");
  });

  it("cancels generation without retaining its history or affecting another session", async () => {
    await initialize();
    const a = await session();
    const b = await session();
    const pending = peer.start("session/prompt", prompt(a, "fixture:wait"));
    await peer.waitFor(
      (frame) => frame.method === "session/update" && frame.params?.sessionId === a,
    );
    expect(await peer.request("session/prompt", prompt(b, "other"))).toMatchObject({
      result: { stopReason: "end_turn" },
    });
    peer.notify("session/cancel", { sessionId: a });
    expect(await pending.response).toMatchObject({ result: { stopReason: "cancelled" } });
    const after = peer.frames.length;
    await peer.request("session/prompt", prompt(a, "fresh"));
    expect(JSON.parse(output(a, after)).users).toEqual([[{ type: "text", text: "fresh" }]]);
  });

  it("ignores a late approval while the next prompt waits for its own permission", async () => {
    await initialize();
    const id = await session();
    const first = peer.start("session/prompt", prompt(id, "fixture:tools"));
    const stale = await peer.waitFor(permission);
    peer.notify("session/cancel", { sessionId: id });
    expect(await first.response).toMatchObject({ result: { stopReason: "cancelled" } });
    const after = peer.frames.length;
    const second = peer.start("session/prompt", prompt(id, "fixture:tools"));
    const current = await peer.waitFor(permission, after);
    peer.reply(stale, allow);
    await peer.request("authenticate", { methodId: "barrier" });
    expect(peer.frames.some((frame) => frame.id === second.id)).toBe(false);
    expect(peer.stderr()).not.toContain("fixture tool executed");
    peer.reply(current, { outcome: { outcome: "cancelled" } });
    expect(await second.response).toMatchObject({ result: { stopReason: "cancelled" } });
    expect(peer.stderr()).not.toContain("fixture tool executed");
  });

  it("cancels an approved real MCP call and closes both negotiation and session processes", async () => {
    await peer.close();
    peer = stdioClient("test/fixtures/editor-host.mjs", []);
    await initialize();
    const log = join(root, "mcp.jsonl");
    const records = async (): Promise<Array<{ pid: number; event: string }>> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const created = await peer.request("session/new", {
      cwd: root,
      mcpServers: [
        {
          name: "waiting-mcp",
          command: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url))],
          env: [
            { name: "FIXTURE_LOG", value: log },
            { name: "FIXTURE_MODE", value: "call-wait" },
          ],
        },
      ],
    });
    expect(created.error).toBeUndefined();
    const id = (created.result as { sessionId: string }).sessionId;
    const pending = peer.start("session/prompt", prompt(id, "fixture:mcp"));
    peer.reply(await peer.waitFor(permission), allow);
    await vi.waitFor(async () =>
      expect((await records()).some((entry) => entry.event === "tools/call")).toBe(true),
    );
    peer.notify("session/cancel", { sessionId: id });
    expect(await pending.response).toMatchObject({ result: { stopReason: "cancelled" } });
    await vi.waitFor(async () =>
      expect((await records()).some((entry) => entry.event === "notifications/cancelled")).toBe(
        true,
      ),
    );
    await peer.close();
    const events = await records();
    expect(events.filter((entry) => entry.event === "start")).toHaveLength(2);
    expect(
      events
        .filter((entry) => entry.event === "exit")
        .map((entry) => entry.pid)
        .sort(),
    ).toEqual(
      events
        .filter((entry) => entry.event === "start")
        .map((entry) => entry.pid)
        .sort(),
    );
    expect(
      updates(id).some(
        (update) => update.sessionUpdate === "tool_call_update" && update.status === "completed",
      ),
    ).toBe(false);
  });

  it.each(["read", "terminal"])(
    "cancels an editor %s callback over stdio and ignores its late result",
    async (operation) => {
      // Opt-in belongs to the library host; the dedicated launcher retains conservative defaults.
      await peer.close();
      peer = stdioClient("test/fixtures/editor-host.mjs", []);
      await peer.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true }, terminal: true },
      });
      const id = await session();
      const pending = peer.start("session/prompt", prompt(id, `fixture:${operation}`));
      peer.reply(await peer.waitFor(permission), allow);
      if (operation === "terminal") {
        const created = await peer.waitFor((frame) => frame.method === "terminal/create");
        expect(created.params).toMatchObject({
          sessionId: id,
          cwd: root,
          command: "fixture-command",
        });
        peer.reply(created, { terminalId: "fixture-terminal" });
      }
      const callback = await peer.waitFor(
        (frame) =>
          frame.method === (operation === "read" ? "fs/read_text_file" : "terminal/wait_for_exit"),
      );
      expect(callback.params?.sessionId).toBe(id);
      if (operation === "read") expect(callback.params?.path).toBe(join(root, "buffer.txt"));
      peer.notify("session/cancel", { sessionId: id });
      expect(await pending.response).toMatchObject({ result: { stopReason: "cancelled" } });
      peer.reply(callback, operation === "read" ? { content: "late buffer" } : { exitCode: 0 });
      if (operation === "terminal") {
        const kill = await peer.waitFor((frame) => frame.method === "terminal/kill");
        expect(kill.params).toEqual({ sessionId: id, terminalId: "fixture-terminal" });
        peer.reply(kill, {});
        const release = await peer.waitFor((frame) => frame.method === "terminal/release");
        expect(release.params).toEqual(kill.params);
        peer.reply(release, {});
      }
      await peer.close();
      const settlement = peer.frames.findIndex((frame) => frame.id === pending.id);
      expect(
        peer.frames.slice(settlement + 1).filter((frame) => frame.method === "session/update"),
      ).toEqual([]);
    },
  );
});
