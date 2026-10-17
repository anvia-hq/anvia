import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const children: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function launch(args: string[]) {
  const child = spawn(process.execPath, ["dist/cli.js", ...args], {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr!.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const closed = once(child, "close");
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

describe("built anvia-acp launcher", () => {
  it("creates a session and completes successive offline prompts over real stdio", async () => {
    const peer = launch(["examples/sample-agent.mjs"]);
    let id = 0;
    async function request(method: string, params: unknown) {
      const requestId = ++id;
      peer.child.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n",
      );
      const responses = () =>
        peer
          .stdout()
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      await vi.waitFor(() =>
        expect(responses().some((response) => response.id === requestId)).toBe(true),
      );
      return responses().find((response) => response.id === requestId);
    }
    await request("initialize", { protocolVersion: 1 });
    const created = await request("session/new", { cwd: packageRoot, mcpServers: [] });
    expect(created.error).toBeUndefined();
    for (const text of ["hello", "again"]) {
      expect(
        await request("session/prompt", {
          sessionId: created.result.sessionId,
          prompt: [{ type: "text", text }],
        }),
      ).toMatchObject({ result: { stopReason: "end_turn" } });
    }
    peer.child.stdin!.end();
    expect(await peer.closed).toEqual([0, null]);
  });

  it.each([
    "examples/sample-agent.mjs",
    "test/fixtures/noisy-agent.mjs",
    "test/fixtures/session-factory.mjs",
    "test/fixtures/background-agent.mjs",
  ])("loads %s and completes the stdio handshake", async (modulePath) => {
    const peer = launch([modulePath]);
    peer.child.stdin!.write(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\n',
    );
    await vi.waitFor(() => expect(peer.stdout()).toContain("\n"));
    expect(JSON.parse(peer.stdout())).toMatchObject({
      id: 1,
      result: { protocolVersion: 1, authMethods: [] },
    });
    if (modulePath.includes("noisy")) {
      expect(peer.stderr()).toContain("module console log");
      expect(peer.stderr()).toContain("module console info");
      expect(peer.stderr()).toContain("module console debug");
      expect(peer.stderr()).toContain("module console warning");
      expect(peer.stderr()).toContain("module console error");
      expect(peer.stderr()).toContain("module direct stdout write");
    }
    peer.child.stdin!.end();
    expect(await peer.closed).toEqual([0, null]);
  });

  it.each([
    [],
    ["missing.mjs"],
    ["test/fixtures/invalid-module.mjs"],
    ["test/fixtures/throwing-module.mjs"],
  ])("reports invalid startup only on stderr (%j)", async (...args) => {
    const peer = launch(args);
    expect(await peer.closed).toEqual([1, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).not.toBe("");
    expect(peer.stderr()).not.toContain("private-provider-credential");
  });

  it("prints help to stderr", async () => {
    const peer = launch(["--help"]);
    expect(await peer.closed).toEqual([0, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).toContain("Usage: anvia-acp");
  });

  it.each(["SIGINT", "SIGTERM"] as const)("exits on %s", async (signal) => {
    const peer = launch(["examples/sample-agent.mjs"]);
    peer.child.stdin!.write(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\n',
    );
    await vi.waitFor(() => expect(peer.stdout()).toContain("\n"));
    peer.child.kill(signal);
    expect(await peer.closed).toEqual([0, null]);
  });
});
