import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSandboxTools } from "../../src/tools";
import type { SandboxRuntime, SandboxRuntimeLimits } from "../../src/types";

export interface ConformanceTarget {
  runtime: SandboxRuntime;
  cleanup(): Promise<void>;
}

export interface ConformanceOptions {
  /** Whether the suite should be skipped, for example when Docker is unavailable. */
  skip?: boolean;
  create(limits: SandboxRuntimeLimits): Promise<ConformanceTarget>;
  timeoutMs?: number;
}

const limits = {
  commandTimeoutMs: 20_000,
  maxOutputBytes: 1024,
  maxFileBytes: 64 * 1024,
  maxProcesses: 3,
} satisfies SandboxRuntimeLimits;

const decoder = new TextDecoder();
const text = (bytes: Uint8Array) => decoder.decode(bytes);

/**
 * Behavior every SandboxRuntime must share. Runs unchanged against Docker and Remote so the two
 * cannot drift. Anything specific to one runtime belongs in that runtime's own tests.
 */
export function describeSandboxRuntimeConformance(name: string, options: ConformanceOptions): void {
  describe.skipIf(options.skip === true)(
    `${name} conformance`,
    { timeout: options.timeoutMs ?? 30_000 },
    () => {
      let target: ConformanceTarget;
      let runtime: SandboxRuntime;

      beforeAll(async () => {
        target = await options.create(limits);
        runtime = target.runtime;
      }, 180_000);

      afterAll(async () => {
        await target?.cleanup();
      }, 60_000);

      describe("exec", () => {
        it("returns output, exit codes, and stderr", async () => {
          const ok = await runtime.exec({ command: "sh", args: ["-c", "echo out; echo err >&2"] });
          expect(ok).toMatchObject({ status: "exited", exitCode: 0 });
          expect(text(ok.stdout)).toBe("out\n");
          expect(text(ok.stderr)).toBe("err\n");

          const failed = await runtime.exec({ command: "sh", args: ["-c", "exit 7"] });
          expect(failed).toMatchObject({ status: "exited", exitCode: 7 });
        });

        it("reports a missing command as an exit status, not a thrown error", async () => {
          const result = await runtime.exec({ command: "anvia-no-such-command" });
          expect(result.status).toBe("exited");
          expect(result.status === "exited" && result.exitCode).not.toBe(0);
        });

        it("passes input, env, and cwd", async () => {
          await runtime.exec({ command: "mkdir", args: ["-p", "exec-cwd"] });
          const input = await runtime.exec({ command: "cat", input: "from stdin" });
          expect(text(input.stdout)).toBe("from stdin");

          const bytes = await runtime.exec({ command: "cat", input: new Uint8Array([104, 105]) });
          expect(text(bytes.stdout)).toBe("hi");

          const env = await runtime.exec({
            command: "sh",
            args: ["-c", 'printf "%s:%s" "$ANVIA_CONFORMANCE" "$(basename "$PWD")"'],
            cwd: "exec-cwd",
            env: { ANVIA_CONFORMANCE: "yes" },
          });
          expect(text(env.stdout)).toBe("yes:exec-cwd");
        });

        it("times out and reports it", async () => {
          const result = await runtime.exec({ command: "sleep", args: ["10"], timeoutMs: 300 });
          expect(result.status).toBe("timed_out");
        });

        it("bounds captured output", async () => {
          const result = await runtime.exec({
            command: "sh",
            args: ["-c", "head -c 5000 /dev/zero | tr '\\0' x"],
          });
          expect(result.stdout.byteLength).toBe(limits.maxOutputBytes);
          expect(result.stdoutTruncated).toBe(true);
        });

        it("rejects when aborted", async () => {
          const controller = new AbortController();
          const pending = runtime.exec({
            command: "sleep",
            args: ["10"],
            abortSignal: controller.signal,
          });
          setTimeout(() => controller.abort(new Error("stop")), 150);
          await expect(pending).rejects.toThrow("stop");
        });

        it("rejects an already-aborted signal", async () => {
          await expect(
            runtime.exec({ command: "true", abortSignal: AbortSignal.abort(new Error("early")) }),
          ).rejects.toThrow("early");
        });

        it("streams output in order and ends with the result", async () => {
          const events: string[] = [];
          let final: unknown;
          for await (const event of runtime.execStream({
            command: "sh",
            args: ["-c", "echo one; sleep 0.1; echo two; sleep 0.1; echo three >&2"],
          })) {
            if (event.type === "result") final = event.result;
            else events.push(`${event.type}:${text(event.data).trim()}`);
          }
          expect(events.filter((entry) => entry.startsWith("stdout")).join("|")).toBe(
            "stdout:one|stdout:two",
          );
          expect(events).toContain("stderr:three");
          expect(final).toMatchObject({ status: "exited", exitCode: 0 });
        });
      });

      describe("files", () => {
        it("round-trips text and bytes, creating parent directories", async () => {
          await runtime.writeTextFile({ path: "files/nested/a.txt", text: "héllo\nworld\n" });
          await expect(runtime.readTextFile({ path: "files/nested/a.txt" })).resolves.toBe(
            "héllo\nworld\n",
          );

          const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
          await runtime.writeFile({ path: "files/bin.dat", data: binary });
          await expect(runtime.readFile({ path: "files/bin.dat" })).resolves.toEqual(binary);

          await runtime.writeTextFile({ path: "files/nested/a.txt", text: "replaced" });
          await expect(runtime.readTextFile({ path: "files/nested/a.txt" })).resolves.toBe(
            "replaced",
          );
        });

        it("lists direct children with types and file sizes", async () => {
          await runtime.writeTextFile({ path: "listing/file.txt", text: "12345" });
          await runtime.writeTextFile({ path: "listing/sub/inner.txt", text: "x" });
          const entries = [...(await runtime.listFiles({ path: "listing" }))].sort((a, b) =>
            a.path.localeCompare(b.path),
          );
          expect(entries).toEqual([
            { path: "listing/file.txt", type: "file", size: 5 },
            { path: "listing/sub", type: "directory" },
          ]);
        });

        it("pages text files by line and byte budget", async () => {
          await runtime.writeTextFile({ path: "pages/lines.txt", text: "a\nb\nc\nd\n" });
          await expect(
            runtime.readTextFilePage({ path: "pages/lines.txt", startLine: 2, lineCount: 2 }),
          ).resolves.toEqual({
            content: "b\nc\n",
            startLine: 2,
            endLine: 3,
            nextStartLine: 4,
            truncated: true,
            truncatedBy: "lines",
          });
          await expect(
            runtime.readTextFilePage({ path: "pages/lines.txt", maxBytes: 3 }),
          ).resolves.toMatchObject({ content: "a\nb", truncated: true, truncatedBy: "bytes" });
        });

        it("rejects paths that leave the workspace", async () => {
          await expect(runtime.readFile({ path: "../outside" })).rejects.toMatchObject({
            code: "invalid_path",
          });
          await expect(
            runtime.writeTextFile({ path: "a/../../outside", text: "x" }),
          ).rejects.toMatchObject({ code: "invalid_path" });
        });

        it("enforces maxFileBytes on writes", async () => {
          await expect(
            runtime.writeFile({ path: "big.bin", data: new Uint8Array(limits.maxFileBytes + 1) }),
          ).rejects.toMatchObject({ code: "file_too_large" });
        });

        it("rejects reading a missing file", async () => {
          await expect(runtime.readFile({ path: "missing/nothing.txt" })).rejects.toThrow();
        });

        it("refuses to write through symbolic links", async () => {
          await runtime.exec({
            command: "sh",
            args: [
              "-c",
              "mkdir -p /tmp/anvia-conformance-outside links && printf keep > /tmp/anvia-conformance-outside/target.txt && ln -sfn /tmp/anvia-conformance-outside links/dir && ln -sfn /tmp/anvia-conformance-outside/target.txt links/leaf",
            ],
          });
          for (const target of ["links/leaf", "links/dir/target.txt", "links/dir/new/file.txt"]) {
            await expect(
              runtime.writeTextFile({ path: target, text: "overwrite" }),
            ).rejects.toMatchObject({
              code: "invalid_path",
            });
          }
          const outside = await runtime.exec({
            command: "cat",
            args: ["/tmp/anvia-conformance-outside/target.txt"],
          });
          expect(text(outside.stdout)).toBe("keep");
        });
      });

      describe("processes", () => {
        const stopAll = async () => {
          for (const process of await runtime.listProcesses()) {
            if (process.status === "running") {
              await runtime.stopProcess({ processId: process.id, gracePeriodMs: 200 });
            }
          }
        };
        afterAll(async () => {
          await stopAll().catch(() => undefined);
        });

        it("starts, lists, logs, and stops a managed process", async () => {
          const started = await runtime.startProcess({
            command: "sh",
            args: ["-c", "echo ready; echo oops >&2; sleep 30"],
          });
          expect(started).toMatchObject({ status: "running", command: "sh" });

          const listed = await runtime.listProcesses();
          expect(listed.map((process) => process.id)).toContain(started.id);

          await pollLogs(runtime, started.id, "ready");
          const logs = await runtime.readProcessLogs({ processId: started.id });
          expect(text(logs.stdout)).toContain("ready");
          expect(text(logs.stderr)).toContain("oops");
          const tail = await runtime.readProcessLogs({ processId: started.id, tailBytes: 3 });
          expect(tail.stdout.byteLength).toBeLessThanOrEqual(3);

          const stopped = await runtime.stopProcess({ processId: started.id, gracePeriodMs: 500 });
          expect(stopped.status).toBe("stopped");
          expect(stopped.endedAt).toBeDefined();
        });

        it("records the exit code of a process that ends on its own", async () => {
          const started = await runtime.startProcess({ command: "sh", args: ["-c", "exit 3"] });
          const exited = await eventually(async () => {
            const found = (await runtime.listProcesses()).find(
              (process) => process.id === started.id,
            );
            return found?.status === "exited" ? found : undefined;
          });
          expect(exited.exitCode).toBe(3);
        });

        it("rejects unknown processes and enforces the process limit", async () => {
          await expect(runtime.readProcessLogs({ processId: "nope" })).rejects.toMatchObject({
            code: "process",
          });
          await stopAll();
          const started = [];
          for (let index = 0; index < limits.maxProcesses; index += 1) {
            started.push(await runtime.startProcess({ command: "sleep", args: ["30"] }));
          }
          await expect(
            runtime.startProcess({ command: "sleep", args: ["30"] }),
          ).rejects.toMatchObject({
            code: "process",
          });
          await stopAll();
        });
      });

      describe("tools", () => {
        it("drives the runtime through the shared tool definitions", async () => {
          const tools = createSandboxTools({
            sandbox: runtime,
            tools: ["write_file", "read_file", "exec_command", "list_files"],
          });
          const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
          const call = (name: string, args: unknown) => {
            const tool = byName[name];
            if (tool === undefined) throw new Error(`Missing tool ${name}`);
            return tool.call(args as never, {});
          };

          await call("write_file", { path: "tools/hello.txt", content: "tool says hi\n" });
          await expect(call("read_file", { path: "tools/hello.txt" })).resolves.toMatchObject({
            content: "tool says hi\n",
          });
          await expect(
            call("exec_command", { command: "cat tools/hello.txt" }),
          ).resolves.toMatchObject({
            status: "exited",
            exitCode: 0,
            stdout: "tool says hi\n",
          });
          await expect(call("list_files", { path: "tools" })).resolves.toMatchObject({
            entries: [{ path: "tools/hello.txt", type: "file", size: 13 }],
          });
        });
      });
    },
  );
}

async function pollLogs(runtime: SandboxRuntime, processId: string, needle: string) {
  await eventually(async () => {
    const logs = await runtime.readProcessLogs({ processId });
    return text(logs.stdout).includes(needle);
  });
}

async function eventually<T>(check: () => Promise<T>, timeoutMs = 10_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Condition was not met in time.");
}
