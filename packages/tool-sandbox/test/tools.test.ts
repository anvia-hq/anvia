import { describe, expect, it, vi } from "vitest";
import { createDockerSandboxTools } from "../src/tools";
import type { DockerSandboxRuntime } from "../src/types";

describe("createDockerSandboxTools", () => {
  it("requires an explicit, ordered, non-empty tool selection", () => {
    const sandbox = createRuntime();
    const tools = createDockerSandboxTools({
      sandbox,
      tools: ["list_files", "exec_command"],
    });

    expect(tools.map((tool) => tool.name)).toEqual(["list_files", "exec_command"]);
    expect(Object.isFrozen(tools)).toBe(true);
    expect(() => createDockerSandboxTools({ sandbox, tools: [] } as never)).toThrow("non-empty");
    expect(() => createDockerSandboxTools({ sandbox, tools: ["read_file", "read_file"] })).toThrow(
      "duplicate",
    );
    expect(() => createDockerSandboxTools({ sandbox, tools: ["legacy"] } as never)).toThrow(
      "unsupported",
    );
  });

  it("returns structured command output and propagates abort", async () => {
    const sandbox = createRuntime();
    const [tool] = createDockerSandboxTools({
      sandbox,
      tools: ["exec_command"],
      exec: { defaultTimeoutMs: 1_234 },
    });
    if (tool === undefined) throw new Error("Expected exec_command tool.");
    const controller = new AbortController();

    await expect(
      tool.call(
        { command: "node", args: ["index.js"], cwd: "src", input: "hello" },
        { abortSignal: controller.signal },
      ),
    ).resolves.toEqual({
      status: "exited",
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      durationMs: 10,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    expect(sandbox.exec).toHaveBeenCalledWith({
      command: "node",
      args: ["index.js"],
      cwd: "src",
      input: "hello",
      timeoutMs: 1_234,
      abortSignal: controller.signal,
    });
  });

  it("enforces discriminated command and timeout policies", async () => {
    const [tool] = createDockerSandboxTools({
      sandbox: createRuntime(),
      tools: ["exec_command"],
      exec: {
        commands: { mode: "allow", values: ["node"] },
        maxTimeoutMs: 1_000,
      },
    });
    if (tool === undefined) throw new Error("Expected exec_command tool.");

    await expect(tool.call({ command: "python" })).rejects.toMatchObject({
      code: "tool_policy",
    });
    await expect(tool.call({ command: "node", timeoutMs: 1_001 })).rejects.toThrow(
      "exceeds policy",
    );
  });

  it("delegates text file tools with bounded structured results", async () => {
    const sandbox = createRuntime();
    const tools = toolMap(
      createDockerSandboxTools({
        sandbox,
        tools: ["read_file", "write_file", "list_files"],
        readFile: { defaultLineCount: 20, maxLineCount: 50, maxBytes: 1_024 },
        writeFile: { maxBytes: 8 },
      }),
    );

    await expect(tools.read_file?.call({ path: "a.txt" })).resolves.toEqual({
      content: "file content",
      startLine: 1,
      endLine: 1,
      nextStartLine: null,
      truncated: false,
      truncatedBy: null,
    });
    await expect(tools.write_file?.call({ path: "a.txt", content: "hello" })).resolves.toEqual({
      path: "a.txt",
      bytesWritten: 5,
    });
    await expect(tools.list_files?.call({ path: "." })).resolves.toEqual({
      path: ".",
      entries: [{ path: "a.txt", type: "file", size: 12 }],
    });
    expect(sandbox.readTextFilePage).toHaveBeenCalledWith({
      path: "a.txt",
      startLine: 1,
      lineCount: 20,
      maxBytes: 1_024,
    });
    await expect(tools.read_file?.call({ path: "a.txt", lineCount: 51 })).rejects.toThrow(
      "exceeds policy",
    );
    await expect(tools.write_file?.call({ path: "a.txt", content: "123456789" })).rejects.toThrow(
      "exceeds policy",
    );
  });

  it("delegates process and port tools with structured results", async () => {
    const sandbox = createRuntime();
    const tools = toolMap(
      createDockerSandboxTools({
        sandbox,
        tools: [
          "list_ports",
          "start_process",
          "list_processes",
          "read_process_logs",
          "stop_process",
          "wait_for_port",
        ],
        exec: { commands: { mode: "block", values: ["curl"] } },
        process: {
          maxLogBytes: 1_024,
          defaultWaitTimeoutMs: 1_234,
          stopGracePeriodMs: 250,
        },
      }),
    );

    await expect(tools.list_ports?.call({})).resolves.toEqual({
      ports: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    });
    await expect(tools.start_process?.call({ command: "pnpm", args: ["dev"] })).resolves.toEqual(
      processInfo,
    );
    await expect(tools.list_processes?.call({})).resolves.toEqual({ processes: [processInfo] });
    await expect(
      tools.read_process_logs?.call({ processId: "process_1", tailBytes: 512 }),
    ).resolves.toEqual({
      processId: "process_1",
      stdout: "ready\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    await expect(tools.stop_process?.call({ processId: "process_1" })).resolves.toEqual(
      processInfo,
    );
    await expect(tools.wait_for_port?.call({ containerPort: 5173 })).resolves.toEqual({
      port: { containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" },
    });
    expect(sandbox.stopProcess).toHaveBeenCalledWith({
      processId: "process_1",
      gracePeriodMs: 250,
    });
    expect(sandbox.waitForPort).toHaveBeenCalledWith({
      containerPort: 5173,
      timeoutMs: 1_234,
    });
  });

  it("rejects invalid policy combinations eagerly", () => {
    const sandbox = createRuntime();
    expect(() =>
      createDockerSandboxTools({
        sandbox,
        tools: ["read_file"],
        readFile: { defaultLineCount: 2, maxLineCount: 1 },
      }),
    ).toThrow("cannot exceed");
    expect(() =>
      createDockerSandboxTools({
        sandbox,
        tools: ["exec_command"],
        exec: { commands: { mode: "allow", values: ["node", "node"] } },
      }),
    ).toThrow("duplicate");
  });

  it("snapshots selection and command policy inputs", async () => {
    const selected: ["exec_command"] = ["exec_command"];
    const allowed = ["node"];
    const tools = createDockerSandboxTools({
      sandbox: createRuntime(),
      tools: selected,
      exec: { commands: { mode: "allow", values: allowed } },
    });
    selected[0] = "exec_command";
    allowed[0] = "python";

    await expect(tools[0]?.call({ command: "node" })).resolves.toMatchObject({
      status: "exited",
    });
    await expect(tools[0]?.call({ command: "python" })).rejects.toMatchObject({
      code: "tool_policy",
    });
  });

  it("rejects malformed UTF-8 process logs instead of coercing them", async () => {
    const sandbox = createRuntime();
    vi.mocked(sandbox.readProcessLogs).mockResolvedValueOnce({
      stdout: new Uint8Array([0xff]),
      stderr: new Uint8Array(),
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const [tool] = createDockerSandboxTools({
      sandbox,
      tools: ["read_process_logs"],
    });
    await expect(tool?.call({ processId: "process_1" })).rejects.toThrow();
  });
});

const processInfo = {
  id: "process_1",
  command: "pnpm",
  args: ["dev"],
  status: "running" as const,
  startedAt: "2026-01-01T00:00:00.000Z",
};

function createRuntime(): DockerSandboxRuntime {
  return {
    id: "sandbox_1",
    provider: "docker",
    workdir: "/workspace",
    publishedPorts: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    exec: vi.fn(async () => ({
      status: "exited" as const,
      exitCode: 0,
      stdout: new TextEncoder().encode("ok\n"),
      stderr: new Uint8Array(),
      durationMs: 10,
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    execStream: vi.fn(async function* () {
      yield {
        type: "result" as const,
        result: {
          status: "exited" as const,
          exitCode: 0,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          durationMs: 1,
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      };
    }),
    readFile: vi.fn(async () => new Uint8Array()),
    readTextFile: vi.fn(async () => "file content"),
    readTextFilePage: vi.fn(async (options) => ({
      content: "file content",
      startLine: options.startLine ?? 1,
      endLine: options.startLine ?? 1,
      nextStartLine: null,
      truncated: false,
      truncatedBy: null,
    })),
    writeFile: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => [{ path: "a.txt", type: "file" as const, size: 12 }]),
    startProcess: vi.fn(async () => processInfo),
    listProcesses: vi.fn(async () => [processInfo]),
    readProcessLogs: vi.fn(async () => ({
      stdout: new TextEncoder().encode("ready\n"),
      stderr: new Uint8Array(),
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    stopProcess: vi.fn(async () => processInfo),
    waitForPort: vi.fn(async () => ({
      containerPort: 5173,
      host: "127.0.0.1" as const,
      hostPort: 49152,
      protocol: "tcp" as const,
    })),
  };
}

function toolMap(tools: readonly { name: string; call: (input: unknown) => unknown }[]) {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool] as const));
}
