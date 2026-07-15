import { describe, expect, it, vi } from "vitest";
import { createSandboxTools } from "../src/tools";
import type { DockerSandboxSession, SandboxSession } from "../src/types";

describe("createSandboxTools", () => {
  it("creates the default sandbox tool bundle", () => {
    const tools = createSandboxTools(createSession());

    expect(tools.map((tool) => tool.name)).toEqual([
      "exec_command",
      "read_file",
      "write_file",
      "list_files",
    ]);
  });

  it("allows selecting a subset of tools", () => {
    const tools = createSandboxTools(createSession(), { include: ["read_file"] });

    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
  });

  it("supports allow as a tool selection alias", () => {
    const tools = createSandboxTools(createSession(), { allow: ["list_files"] });

    expect(tools.map((tool) => tool.name)).toEqual(["list_files"]);
  });

  it("exec_command calls the sandbox session with structured args", async () => {
    const session = createSession();
    const [tool] = createSandboxTools(session, { include: ["exec_command"], execTimeoutMs: 1234 });
    if (tool === undefined) {
      throw new Error("Expected exec_command tool.");
    }

    const output = await tool.call({
      command: "node",
      args: ["index.js"],
      cwd: "src",
      input: "hello",
    });

    expect(session.exec).toHaveBeenCalledWith({
      command: "node",
      args: ["index.js"],
      cwd: "src",
      timeoutMs: 1234,
      input: "hello",
    });
    expect(output).toContain("exit_code: 0");
    expect(output).toContain("stdout:");
  });

  it("enforces exec command policy", async () => {
    const session = createSession();
    const [tool] = createSandboxTools(session, {
      allow: ["exec_command"],
      exec: {
        allowedCommands: ["node"],
        maxTimeoutMs: 1000,
      },
    });
    if (tool === undefined) {
      throw new Error("Expected exec_command tool.");
    }

    await expect(tool.call({ command: "python" })).rejects.toThrow(
      "Command is not allowed by sandbox tool policy",
    );
    await expect(tool.call({ command: "node", timeoutMs: 2000 })).rejects.toThrow(
      "Command timeout exceeds sandbox tool policy",
    );
  });

  it("enforces file tool byte policies", async () => {
    const session = createSession();
    const tools = Object.fromEntries(
      createSandboxTools(session, {
        readFile: { maxBytes: 4 },
        writeFile: { maxBytes: 4 },
      }).map((tool) => [tool.name, tool] as const),
    );

    await expect(tools.read_file?.call({ path: "a.txt" })).rejects.toThrow(
      "File content exceeds sandbox tool policy",
    );
    await expect(tools.write_file?.call({ path: "a.txt", content: "content" })).rejects.toThrow(
      "File content exceeds sandbox tool policy",
    );
  });

  it("read_file, write_file, and list_files delegate to the session", async () => {
    const session = createSession();
    const tools = Object.fromEntries(
      createSandboxTools(session).map((tool) => [tool.name, tool] as const),
    );

    await tools.write_file?.call({ path: "a.txt", content: "content" });
    const read = await tools.read_file?.call({ path: "a.txt" });
    const list = await tools.list_files?.call({ path: "." });

    expect(session.writeTextFile).toHaveBeenCalledWith("a.txt", "content");
    expect(session.readTextFile).toHaveBeenCalledWith("a.txt");
    expect(session.listFiles).toHaveBeenCalledWith(".");
    expect(read).toBe("file content");
    expect(list).toContain("file 12b\ta.txt");
  });

  it("creates opt-in published port and managed process tools", () => {
    const tools = createSandboxTools(createManagedSession(), {
      include: [
        "list_ports",
        "start_process",
        "list_processes",
        "read_process_logs",
        "stop_process",
        "wait_for_port",
      ],
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_ports",
      "start_process",
      "list_processes",
      "read_process_logs",
      "stop_process",
      "wait_for_port",
    ]);
  });

  it("delegates managed process and port tools with structured input", async () => {
    const session = createManagedSession();
    const tools = Object.fromEntries(
      createSandboxTools(session, {
        include: [
          "list_ports",
          "start_process",
          "list_processes",
          "read_process_logs",
          "stop_process",
          "wait_for_port",
        ],
        exec: { allowedCommands: ["pnpm"] },
        process: {
          maxLogBytes: 1024,
          defaultWaitTimeoutMs: 1234,
          stopGracePeriodMs: 250,
        },
      }).map((tool) => [tool.name, tool] as const),
    );

    const ports = await tools.list_ports?.call({});
    const started = await tools.start_process?.call({
      command: "pnpm",
      args: ["dev"],
      cwd: "site",
    });
    await tools.list_processes?.call({});
    const logs = await tools.read_process_logs?.call({ processId: "process_1", tailBytes: 512 });
    await tools.stop_process?.call({ processId: "process_1" });
    const ready = await tools.wait_for_port?.call({ containerPort: 5173 });

    expect(ports).toContain("5173/tcp");
    expect(started).toContain("process_id: process_1");
    expect(logs).toContain("stdout:");
    expect(ready).toContain("ready: 5173/tcp");
    expect(session.startProcess).toHaveBeenCalledWith({
      command: "pnpm",
      args: ["dev"],
      cwd: "site",
    });
    expect(session.readProcessLogs).toHaveBeenCalledWith("process_1", { tailBytes: 512 });
    expect(session.stopProcess).toHaveBeenCalledWith("process_1", { gracePeriodMs: 250 });
    expect(session.waitForPort).toHaveBeenCalledWith(5173, { timeoutMs: 1234 });
  });

  it("applies command and log policies to managed process tools", async () => {
    const tools = Object.fromEntries(
      createSandboxTools(createManagedSession(), {
        include: ["start_process", "read_process_logs"],
        exec: { allowedCommands: ["node"] },
        process: { maxLogBytes: 128 },
      }).map((tool) => [tool.name, tool] as const),
    );

    await expect(tools.start_process?.call({ command: "pnpm" })).rejects.toThrow(
      "Command is not allowed",
    );
    await expect(
      tools.read_process_logs?.call({ processId: "process_1", tailBytes: 129 }),
    ).rejects.toThrow("exceeds sandbox tool policy");
  });

  it("rejects process tools for sessions without the capability", () => {
    expect(() => createSandboxTools(createSession(), { include: ["start_process"] })).toThrow(
      "does not support managed process tools",
    );
    expect(() => createSandboxTools(createSession(), { include: ["list_ports"] })).toThrow(
      "does not support published port tools",
    );
  });
});

function createSession(): SandboxSession {
  return {
    id: "session_1",
    provider: "test",
    workdir: "/workspace",
    exec: vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
      aborted: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    execStream: vi.fn(async function* () {
      yield {
        type: "exit" as const,
        result: {
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
          durationMs: 10,
          timedOut: false,
          aborted: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      };
    }),
    readFile: vi.fn(async () => new TextEncoder().encode("file content")),
    readTextFile: vi.fn(async () => "file content"),
    writeFile: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => [{ path: "a.txt", type: "file" as const, size: 12 }]),
    destroy: vi.fn(async () => undefined),
  };
}

function createManagedSession(): DockerSandboxSession {
  return {
    ...createSession(),
    publishedPorts: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49_152, protocol: "tcp" }],
    waitForPort: vi.fn(async () => ({
      containerPort: 5173,
      host: "127.0.0.1" as const,
      hostPort: 49_152,
      protocol: "tcp" as const,
    })),
    startProcess: vi.fn(async () => ({
      id: "process_1",
      command: "pnpm",
      args: ["dev"],
      status: "running" as const,
      startedAt: "2026-07-15T00:00:00.000Z",
    })),
    listProcesses: vi.fn(async () => [
      {
        id: "process_1",
        command: "pnpm",
        args: ["dev"],
        status: "running" as const,
        startedAt: "2026-07-15T00:00:00.000Z",
      },
    ]),
    readProcessLogs: vi.fn(async () => ({
      stdout: "ready\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    stopProcess: vi.fn(async () => ({
      id: "process_1",
      command: "pnpm",
      args: ["dev"],
      status: "stopped" as const,
      exitCode: 143,
      startedAt: "2026-07-15T00:00:00.000Z",
      endedAt: "2026-07-15T00:00:01.000Z",
    })),
  };
}
