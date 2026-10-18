import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { packageRoot, type Frame } from "./stdio-client.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function child(dir: string, mode: string, phase: string) {
  const process = fork(join(packageRoot, "test/fixtures/durable-process.mjs"), [dir, mode, phase], {
    silent: true,
  });
  const frames: Frame[] = [];
  const control: unknown[] = [];
  let buffer = "",
    stderr = "";
  process.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      frames.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  process.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  process.on("message", (message) => control.push(message));
  const closed = new Promise<void>((resolve) => process.on("close", () => resolve()));
  const kill = async () => {
    process.kill("SIGKILL");
    await closed;
  };
  cleanup.push(kill);
  const send = (frame: Omit<Frame, "jsonrpc">) =>
    process.stdin!.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
  let id = 0;
  const wait = async (predicate: (frame: Frame) => boolean, after = 0) => {
    await vi.waitFor(() => expect(frames.slice(after).some(predicate), stderr).toBe(true), {
      timeout: 10_000,
    });
    return frames.slice(after).find(predicate)!;
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const next = ++id;
    send({ method, params, id: next });
    return wait((frame) => frame.id === next && !frame.method);
  };
  return { process, frames, control, kill, send, wait, request };
}

it.each(["approval", "completed", "ambiguous", "idempotent"])(
  "recovers %s after SIGKILL without repeating editor-independent effects",
  async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), "acp-process-"));
    cleanup.push(() => rm(dir, { force: true, recursive: true }));
    const first = child(dir, mode, "start");
    await first.request("initialize", { protocolVersion: 1 });
    const created = await first.request("session/new", { cwd: dir, mcpServers: [] });
    const { sessionId } = created.result as { sessionId: string };
    first.send({
      method: "session/prompt",
      id: "turn",
      params: { sessionId, prompt: [{ type: "text", text: "write" }] },
    });
    if (mode === "approval") {
      await first.wait((frame) => frame.method === "session/request_permission");
    } else {
      await vi.waitFor(() => expect(first.control).toContainEqual({ checkpoint: true }), {
        timeout: 10_000,
      });
    }
    await first.kill();
    const second = child(dir, mode, "recover");
    await second.request("initialize", { protocolVersion: 1 });
    expect((await second.request("session/resume", { sessionId, cwd: dir })).error).toBeUndefined();
    const turn = second.request("session/prompt", { sessionId, prompt: [] });
    if (mode === "approval") {
      const permission = await second.wait(
        (frame) => frame.method === "session/request_permission",
      );
      second.send({
        id: permission.id!,
        result: { outcome: { outcome: "selected", optionId: "allow_once" } },
      });
    }
    if (mode === "ambiguous") {
      expect((await turn).error?.data).toEqual({ kind: "recovery_required" });
      second.process.send("reconcile");
      await vi.waitFor(() => expect(second.control).toContainEqual({ reconciled: true }), {
        timeout: 10_000,
      });
      expect((await second.request("session/prompt", { sessionId, prompt: [] })).result).toEqual({
        stopReason: "end_turn",
      });
    } else {
      expect((await turn).result).toEqual({ stopReason: "end_turn" });
    }
    const receipts = (await readFile(join(dir, "receipt.txt"), "utf8")).trim().split("\n");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toContain("/");
    const attempts = (await readFile(join(dir, "attempts.txt"), "utf8")).trim().split("\n");
    expect(attempts).toEqual(Array(mode === "idempotent" ? 2 : 1).fill(receipts[0]));
    for (const frame of [...first.frames, ...second.frames]) expect(frame.jsonrpc).toBe("2.0");
  },
  30_000,
);
