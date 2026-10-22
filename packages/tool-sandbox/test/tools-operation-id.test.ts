import { describe, expect, it, vi } from "vitest";
import { createSandboxTools } from "../src/tools";
import type { SandboxRuntime } from "../src/types";

function runtime(): SandboxRuntime {
  const info = { id: "p1", command: "sh", args: [], status: "running", startedAt: "now" } as const;
  return {
    id: "s",
    provider: "custom",
    workdir: "/workspace",
    publishedPorts: [],
    exec: vi.fn(async () => ({
      status: "exited" as const,
      exitCode: 0,
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      durationMs: 1,
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    execStream: vi.fn(),
    readFile: vi.fn(),
    readTextFile: vi.fn(),
    readTextFilePage: vi.fn(),
    writeFile: vi.fn(),
    writeTextFile: vi.fn(async () => undefined),
    listFiles: vi.fn(),
    startProcess: vi.fn(async () => info),
    listProcesses: vi.fn(),
    readProcessLogs: vi.fn(),
    stopProcess: vi.fn(async () => ({ ...info, status: "stopped" as const })),
    waitForPort: vi.fn(async () => ({ containerPort: 3000, protocol: "tcp" as const })),
  } as unknown as SandboxRuntime;
}

describe("createSandboxTools operationId", () => {
  it("accepts any provider and forwards context.operationId on every mutating tool", async () => {
    const sandbox = runtime();
    const tools = createSandboxTools({
      sandbox,
      tools: ["exec_command", "write_file", "start_process", "stop_process", "wait_for_port"],
    });
    const call = (name: string, args: unknown, operationId?: string) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new Error(name);
      return tool.call(args as never, operationId === undefined ? {} : { operationId });
    };

    await call("exec_command", { command: "ls", args: [] }, "op-exec");
    await call("write_file", { path: "a.txt", content: "x" }, "op-write");
    await call("start_process", { command: "sleep", args: ["1"] }, "op-start");
    await call("stop_process", { processId: "p1" }, "op-stop");

    expect(sandbox.exec).toHaveBeenCalledWith(expect.objectContaining({ operationId: "op-exec" }));
    expect(sandbox.writeTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-write" }),
    );
    expect(sandbox.startProcess).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-start" }),
    );
    expect(sandbox.stopProcess).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-stop" }),
    );
  });

  it("omits operationId when the run has none", async () => {
    const sandbox = runtime();
    const [tool] = createSandboxTools({ sandbox, tools: ["write_file"] });
    await tool?.call({ path: "a.txt", content: "x" } as never, {});
    expect(sandbox.writeTextFile).toHaveBeenCalledWith({ path: "a.txt", text: "x" });
  });

  it("reports wait_for_port without a host address for runtimes that have none", async () => {
    const [tool] = createSandboxTools({ sandbox: runtime(), tools: ["wait_for_port"] });
    await expect(tool?.call({ containerPort: 3000 } as never, {})).resolves.toEqual({
      port: { containerPort: 3000, protocol: "tcp" },
    });
  });
});
