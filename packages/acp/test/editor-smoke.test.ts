import type { SessionNotification } from "@agentclientprotocol/sdk";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageRoot, stdioClient } from "./stdio-client.js";

let root: string;
let peer: ReturnType<typeof stdioClient> | undefined;
const sample = join(packageRoot, "examples/editor-smoke-agent.mjs");
const cli = join(packageRoot, "dist/cli.js");
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp editor smoke ")));
});
afterEach(async () => {
  try {
    await peer?.close();
  } finally {
    peer = undefined;
    await rm(root, { recursive: true, force: true });
  }
});
const permission = (frame: { method?: string }) => frame.method === "session/request_permission";
const prompt = (sessionId: string, text: string) => ({
  sessionId,
  prompt: [{ type: "text", text }],
});
function textSince(after = 0) {
  return peer!.frames.slice(after).flatMap((frame) => {
    if (frame.method !== "session/update") return [];
    const update = (frame.params as unknown as SessionNotification).update;
    return update.sessionUpdate === "agent_message_chunk" && update.content.type === "text"
      ? [update.content.text]
      : [];
  });
}
async function setup(mcp = false) {
  peer = mcp ? stdioClient("test/fixtures/smoke-host.mjs", []) : stdioClient(cli, [sample]);
  expect(await peer.request("initialize", { protocolVersion: 1 })).toMatchObject({
    result: { protocolVersion: 1, authMethods: [] },
  });
  const created = await peer.request("session/new", {
    cwd: root,
    mcpServers: mcp
      ? [
          {
            name: "anvia-smoke",
            command: process.execPath,
            args: [join(packageRoot, "examples/editor-smoke-mcp.mjs")],
            env: [],
          },
        ]
      : [],
  });
  expect(created.error).toBeUndefined();
  return (created.result as { sessionId: string }).sessionId;
}

describe("editor smoke sample over stdio (fixture client, not an editor)", () => {
  it("streams multiple turns, requires each approval, rejects without execution and isolates sessions", async () => {
    const id = await setup();
    const first = peer!.start("session/prompt", prompt(id, "hello"));
    await peer!.waitFor(
      (frame) =>
        frame.method === "session/update" &&
        (frame.params as unknown as SessionNotification).update.sessionUpdate ===
          "agent_message_chunk",
    );
    expect(peer!.frames.some((frame) => frame.id === first.id)).toBe(false);
    expect(await first.response).toMatchObject({ result: { stopReason: "end_turn" } });
    expect(textSince()).toHaveLength(3);
    const after = peer!.frames.length;
    await peer!.request("session/prompt", prompt(id, "again"));
    expect(textSince(after).join("")).toContain("Turn: 2. Counter: 0.\nPrevious: hello.");
    const toolIds = [];
    for (const [optionId, expectedCounter] of [
      ["allow_once", 1],
      ["reject_once", 1],
      ["allow_once", 2],
    ] as const) {
      const cursor = peer!.frames.length;
      const turn = peer!.start("session/prompt", prompt(id, "smoke:tool"));
      const request = await peer!.waitFor(permission, cursor);
      const toolCall = request.params!.toolCall as { toolCallId: string; title: string };
      toolIds.push(toolCall.toolCallId);
      expect(toolCall.title).toBe("Increment smoke counter");
      expect(peer!.frames.some((frame) => frame.id === turn.id)).toBe(false);
      peer!.reply(request, { outcome: { outcome: "selected", optionId } });
      expect(await turn.response).toMatchObject({ result: { stopReason: "end_turn" } });
      expect(textSince(cursor).join("")).toContain(`Counter: ${expectedCounter}.`);
      expect(peer!.frames.slice(cursor)).toContainEqual(
        expect.objectContaining({
          method: "session/update",
          params: {
            sessionId: id,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: toolCall.toolCallId,
              status: optionId === "allow_once" ? "completed" : "failed",
            },
          },
        }),
      );
    }
    expect(new Set(toolIds).size).toBe(3);
    const other = await peer!.request("session/new", { cwd: root, mcpServers: [] });
    const cursor = peer!.frames.length;
    await peer!.request(
      "session/prompt",
      prompt((other.result as { sessionId: string }).sessionId, "new"),
    );
    expect(textSince(cursor).join("")).toContain("Turn: 1. Counter: 0.");
  });

  it.each(["smoke:wait", "smoke:tool"])(
    "cancels %s, ignores late approval and permits a fresh turn",
    async (text) => {
      const id = await setup();
      const turn = peer!.start("session/prompt", prompt(id, text));
      const pending = await peer!.waitFor(
        text === "smoke:tool"
          ? permission
          : (frame) => {
              if (frame.method !== "session/update") return false;
              const update = (frame.params as unknown as SessionNotification).update;
              return (
                update.sessionUpdate === "agent_message_chunk" &&
                update.content.type === "text" &&
                update.content.text === "Waiting for cancel…"
              );
            },
      );
      peer!.notify("session/cancel", { sessionId: id });
      expect(await turn.response).toMatchObject({ result: { stopReason: "cancelled" } });
      if (text === "smoke:tool")
        peer!.reply(pending, { outcome: { outcome: "selected", optionId: "allow_once" } });
      const after = peer!.frames.length;
      expect(await peer!.request("session/prompt", prompt(id, "fresh"))).toMatchObject({
        result: { stopReason: "end_turn" },
      });
      expect(textSince(after).join("")).toContain("Turn: 1. Counter: 0.");
    },
  );

  it("executes forwarded stdio MCP only after approval and surfaces its marker/count", async () => {
    const id = await setup(true);
    for (const [optionId, marker] of [
      ["reject_once", null],
      ["allow_once", "calls=1"],
      ["allow_once", "calls=2"],
    ] as const) {
      const after = peer!.frames.length;
      const turn = peer!.start("session/prompt", prompt(id, "smoke:mcp"));
      const request = await peer!.waitFor(permission, after);
      peer!.reply(request, { outcome: { outcome: "selected", optionId } });
      expect(await turn.response).toMatchObject({ result: { stopReason: "end_turn" } });
      if (marker) expect(textSince(after).join("")).toContain(`ACP_MCP_SMOKE_OK ${marker}`);
      else expect(textSince(after).join("")).not.toContain("ACP_MCP_SMOKE_OK");
    }
  });

  it("explains an absent MCP smoke server", async () => {
    const id = await setup();
    await peer!.request("session/prompt", prompt(id, "smoke:mcp"));
    expect(textSince().join("")).toContain("Forward the anvia-smoke stdio server.");
    expect(peer!.frames.some(permission)).toBe(false);
  });

  it("reports simulated credential setup failure on session/new without offering ACP auth", async () => {
    const wrapper = join(root, "missing-credentials.mjs");
    await writeFile(
      wrapper,
      `process.env.ANVIA_ACP_SMOKE_FAILURE = "missing-credentials";\nexport const { sessionFactory } = await import(${JSON.stringify(pathToFileURL(sample).href)});\n`,
    );
    peer = stdioClient(cli, [wrapper]);
    expect(await peer.request("initialize", { protocolVersion: 1 })).toMatchObject({
      result: { authMethods: [] },
    });
    expect(await peer.request("authenticate", { methodId: "unused" })).toMatchObject({
      result: {},
    });
    expect(await peer.request("session/new", { cwd: root, mcpServers: [] })).toMatchObject({
      error: { code: -32603, data: { kind: "configuration_error" } },
    });
    expect(peer.stderr()).toContain(
      "Configure credentials in your Anvia factory, not ACP authenticate",
    );
  });

  it("explains missing configuration on stderr, with nonzero exit and no protocol pollution", () => {
    const result = spawnSync(process.execPath, [cli, sample], {
      env: { ...process.env, ANVIA_ACP_SMOKE_FAILURE: "missing-config" },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "simulated missing model configuration; unset ANVIA_ACP_SMOKE_FAILURE",
    );
  });

  it("generates absolute-path editor snippets without overwriting existing settings", async () => {
    const destination = join(root, "configs");
    const run = () =>
      spawnSync(
        process.execPath,
        [join(packageRoot, "examples/write-editor-configs.mjs"), destination],
        { encoding: "utf8", timeout: 5000 },
      );
    expect(run().status).toBe(0);
    for (const file of ["zed.json", "jetbrains-acp.json"]) {
      const config = JSON.parse(await readFile(join(destination, file), "utf8"));
      expect(config.agent_servers["Anvia smoke"]).toMatchObject({
        command: process.execPath,
        args: [cli, sample],
      });
    }
    const lua = await readFile(join(destination, "codecompanion.lua"), "utf8");
    expect(lua).not.toMatch(/@[A-Z]+@/);
    expect(lua).toContain(sample);
    expect(run().status).toBe(1);
  });
});
