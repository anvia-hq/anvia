import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export type Frame = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** Raw fixture client deliberately avoids the SDK's response normalization. */
export function stdioClient(entry = "dist/cli.js", args = ["test/fixtures/conformance-agent.mjs"]) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const frames: Frame[] = [];
  const requestIds: string[] = [];
  let buffer = "";
  let stderr = "";
  let fault: unknown;
  child.on("error", (error) => {
    fault = error;
  });
  child.stdin.on("error", (error) => {
    fault = error;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const frame = JSON.parse(line) as Frame;
        expect(frame).toBeTypeOf("object");
        expect(frame).not.toBeNull();
        expect(frame.jsonrpc).toBe("2.0");
        expect(
          ["method", "result", "error"].filter((key) => Object.hasOwn(frame, key)),
        ).toHaveLength(1);
        if (Object.hasOwn(frame, "method")) {
          expect(frame.method).toBeTypeOf("string");
          if (Object.hasOwn(frame, "params")) {
            expect(frame.params).not.toBeNull();
            expect(frame.params).toBeTypeOf("object");
          }
        } else {
          expect(Object.hasOwn(frame, "id")).toBe(true);
          if (Object.hasOwn(frame, "error")) {
            expect(frame.error).not.toBeNull();
            expect(frame.error).toBeTypeOf("object");
            expect(Number.isInteger(frame.error!.code)).toBe(true);
            expect(frame.error!.message).toBeTypeOf("string");
          }
        }
        if (Object.hasOwn(frame, "id"))
          expect(
            frame.id === null || typeof frame.id === "string" || Number.isInteger(frame.id),
          ).toBe(true);
        frames.push(frame);
      } catch (error) {
        fault ??= error;
      }
    }
  });
  let exited: { code: number | null; signal: string | null } | undefined;
  const closed = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      exited = { code, signal };
      resolve();
    });
  });
  function send(frame: Frame) {
    child.stdin.write(JSON.stringify(frame) + "\n");
  }
  async function waitFor(predicate: (frame: Frame) => boolean, after = 0): Promise<Frame> {
    await vi.waitFor(
      () => {
        if (fault) throw fault;
        expect(frames.slice(after).some(predicate), stderr).toBe(true);
      },
      { timeout: 5000, interval: 10 },
    );
    return frames.slice(after).find(predicate)!;
  }
  function start(method: string, params: unknown) {
    const id = `client-${requestIds.length + 1}`;
    requestIds.push(id);
    send({ jsonrpc: "2.0", id, method, params: params as Record<string, unknown> });
    return { id, response: waitFor((frame) => !frame.method && frame.id === id) };
  }
  let closing: Promise<void> | undefined;
  async function close() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await closed;
      if (fault) throw fault;
      expect(buffer, "unterminated stdout frame").toBe("");
      expect(exited, stderr).toEqual({ code: 0, signal: null });
      for (const id of requestIds)
        expect(
          frames.filter((frame) => !frame.method && frame.id === id),
          `settlement ${id}`,
        ).toHaveLength(1);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    frames,
    stderr: () => stderr,
    waitFor,
    start,
    request: (method: string, params: unknown) => start(method, params).response,
    notify: (method: string, params: Record<string, unknown>) =>
      send({ jsonrpc: "2.0", method, params }),
    reply(request: Frame, result: unknown) {
      if (request.id === undefined) throw new Error("Cannot reply to a notification");
      send({ jsonrpc: "2.0", id: request.id, result });
    },
    close: () => (closing ??= close()),
  };
}
