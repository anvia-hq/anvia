import { describe, expect, it } from "vitest";
import { DockerSandbox } from "../src/docker-sandbox";

const runDockerTests = process.env.ANVIA_SANDBOX_DOCKER_TESTS === "1";

describe.skipIf(!runDockerTests)("DockerSandbox integration", () => {
  it("creates an ephemeral workspace, runs commands, and cleans up", async () => {
    const sandbox = new DockerSandbox({
      image: "node:22-bookworm",
      pull: "missing",
      limits: {
        timeoutMs: 10_000,
        maxOutputBytes: 64_000,
      },
    });
    const session = await sandbox.createSession({
      id: `vitest-${Date.now()}`,
      manifest: {
        directories: ["src"],
        files: {
          "src/index.js": "console.log('hello sandbox')",
        },
      },
    });

    try {
      const result = await session.exec({
        command: "node",
        args: ["src/index.js"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello sandbox");

      await session.writeTextFile("out/result.txt", "done");
      await expect(session.readTextFile("out/result.txt")).resolves.toBe("done");
      await expect(session.listFiles("out")).resolves.toEqual([
        { path: "out/result.txt", type: "file", size: 4 },
      ]);
    } finally {
      await session.destroy();
    }
  }, 60_000);

  it("reports command timeout", async () => {
    const sandbox = new DockerSandbox({
      image: "node:22-bookworm",
      pull: "missing",
      limits: {
        timeoutMs: 10_000,
      },
    });
    const session = await sandbox.createSession({ id: `timeout-${Date.now()}` });

    try {
      const result = await session.exec({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 10_000)"],
        timeoutMs: 500,
      });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
    } finally {
      await session.destroy();
    }
  }, 60_000);

  it("streams command output and enforces file size limits", async () => {
    const sandbox = new DockerSandbox({
      image: "node:22-bookworm",
      pull: "missing",
      limits: {
        timeoutMs: 10_000,
        maxFileBytes: 4,
      },
    });
    const session = await sandbox.createSession({ id: `stream-${Date.now()}` });

    try {
      const events = [];

      for await (const event of session.execStream({
        command: "node",
        args: ["-e", "console.log('one'); console.error('two')"],
      })) {
        events.push(event);
      }

      expect(events.at(-1)?.type).toBe("exit");
      expect(
        events
          .slice(0, -1)
          .map((event) => event.type)
          .sort(),
      ).toEqual(["stderr", "stdout"]);
      expect(events.find((event) => event.type === "stdout")?.text.trim()).toBe("one");
      expect(events.find((event) => event.type === "stderr")?.text.trim()).toBe("two");
      await expect(session.writeTextFile("too-large.txt", "12345")).rejects.toThrow("maxFileBytes");
    } finally {
      await session.destroy();
    }
  }, 60_000);

  it("emits hooks for public sandbox operations", async () => {
    const events: string[] = [];
    const sandbox = new DockerSandbox({
      image: "node:22-bookworm",
      pull: "missing",
      hooks: {
        onSessionCreate: (event) => {
          events.push(`create:${event.sessionId}`);
        },
        onExecStart: (event) => {
          events.push(`exec:start:${event.command}`);
        },
        onExecEnd: (event) => {
          events.push(`exec:end:${event.result.exitCode}`);
        },
        onFileWrite: (event) => {
          events.push(`write:${event.path}:${event.size}`);
        },
        onDestroy: (event) => {
          events.push(`destroy:${event.sessionId}`);
        },
      },
    });
    const session = await sandbox.createSession({ id: `hooks-${Date.now()}` });

    await session.writeTextFile("out/result.txt", "ok");
    await session.listFiles("out");
    await session.exec({ command: "node", args: ["-e", "console.log('hook')"] });
    const eventsBeforeRejectedStart = [...events];
    await expect(session.startProcess({ command: " " })).rejects.toThrow("cannot be empty");
    expect(events).toEqual(eventsBeforeRejectedStart);
    const process = await session.startProcess({
      command: "node",
      args: ["-e", "console.log('managed hook')"],
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await session.listProcesses())[0]?.status === "exited") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect((await session.listProcesses())[0]?.status).toBe("exited");
    expect((await session.readProcessLogs(process.id)).stdout).toContain("managed hook");
    await session.destroy();

    expect(events).toEqual([
      `create:${session.id}`,
      "write:out/result.txt:2",
      "exec:start:node",
      "exec:end:0",
      "exec:start:node",
      "exec:end:0",
      `destroy:${session.id}`,
    ]);
  }, 60_000);

  it("publishes a preview port and manages a long-running server", async () => {
    const containerPort = 4310;
    const lifecycleEvents: string[] = [];
    const sandbox = DockerSandbox.node({
      pull: "missing",
      network: true,
      limits: {
        timeoutMs: 10_000,
        maxOutputBytes: 64_000,
        maxProcesses: 1,
      },
      hooks: {
        onExecStart: () => {
          lifecycleEvents.push("start");
        },
        onExecEnd: () => {
          lifecycleEvents.push("end");
        },
      },
    });
    const session = await sandbox.createSession({
      id: `preview-${Date.now()}`,
      ports: [containerPort],
    });

    try {
      expect(session.publishedPorts).toHaveLength(1);
      expect(session.publishedPorts[0]).toMatchObject({
        containerPort,
        host: "127.0.0.1",
        protocol: "tcp",
      });

      const process = await session.startProcess({
        command: "node",
        args: [
          "-e",
          [
            'const http = require("node:http");',
            `http.createServer((_request, response) => response.end("sandbox preview"))`,
            `.listen(${containerPort}, "0.0.0.0", () => console.log("preview-ready"));`,
          ].join(""),
        ],
      });
      expect(process.status).toBe("running");
      expect(lifecycleEvents).toEqual(["start"]);

      const publishedPort = await session.waitForPort(containerPort, { timeoutMs: 10_000 });
      const running = await session.listProcesses();
      const startupLogs = await session.readProcessLogs(process.id);
      expect(running[0]?.status, JSON.stringify(startupLogs)).toBe("running");
      const response = await fetch(`http://${publishedPort.host}:${publishedPort.hostPort}`).catch(
        (error: unknown) => {
          throw new Error(
            `Unable to fetch sandbox preview: ${JSON.stringify({ running, startupLogs })}`,
            { cause: error },
          );
        },
      );
      expect(await response.text()).toBe("sandbox preview");

      const logs = await session.readProcessLogs(process.id);
      expect(logs.stdout).toContain("preview-ready");
      const tailLogs = await session.readProcessLogs(process.id, { tailBytes: 5 });
      expect(tailLogs.stdout).toBe("eady\n");
      expect(tailLogs.stdoutTruncated).toBe(true);
      const emptyLogs = await session.readProcessLogs(process.id, { tailBytes: 0 });
      expect(emptyLogs.stdout).toBe("");
      expect(emptyLogs.stdoutTruncated).toBe(true);
      await expect(
        session.startProcess({ command: "node", args: ["-e", "setInterval(() => {}, 1000)"] }),
      ).rejects.toThrow("process limit");
      expect(lifecycleEvents).toEqual(["start"]);

      const stopped = await session.stopProcess(process.id, { gracePeriodMs: 2_000 });
      expect(stopped.status).toBe("stopped");
      expect(await session.listProcesses()).toEqual([stopped]);

      const grandchildServer = [
        'const http = require("node:http");',
        `http.createServer((_request, response) => response.end("grandchild"))`,
        `.listen(${containerPort}, "0.0.0.0");`,
      ].join("");
      const grandchild = await session.startProcess({
        command: "node",
        args: [
          "-e",
          [
            'const { spawn } = require("node:child_process");',
            `spawn(process.execPath, ["-e", ${JSON.stringify(grandchildServer)}], { stdio: "inherit" });`,
            "setInterval(() => {}, 1000);",
          ].join(""),
        ],
      });
      await session.waitForPort(containerPort, { timeoutMs: 10_000 });
      await session.stopProcess(grandchild.id, { gracePeriodMs: 2_000 });
      await expect(
        session.waitForPort(containerPort, { timeoutMs: 500, intervalMs: 50 }),
      ).rejects.toThrow("timed out");

      const loopbackOnly = await session.startProcess({
        command: "node",
        args: [
          "-e",
          `require("node:http").createServer(() => {}).listen(${containerPort}, "127.0.0.1");`,
        ],
      });
      await expect(
        session.waitForPort(containerPort, { timeoutMs: 500, intervalMs: 50 }),
      ).rejects.toThrow("timed out");
      await session.stopProcess(loopbackOnly.id, { gracePeriodMs: 2_000 });
      await expect(session.waitForPort(9999)).rejects.toThrow("not published");
    } finally {
      await session.destroy();
    }
  }, 60_000);

  it("applies idle cleanup while a managed process is running", async () => {
    const sandbox = DockerSandbox.node({
      pull: "missing",
      lifecycle: { idleTimeoutMs: 250 },
      limits: { timeoutMs: 10_000 },
    });
    const session = await sandbox.createSession({ id: `process-idle-${Date.now()}` });

    try {
      await session.startProcess({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
      });
      await new Promise((resolve) => setTimeout(resolve, 750));
      await expect(session.listProcesses()).rejects.toThrow("has been destroyed");
    } finally {
      await session.destroy();
    }
  }, 60_000);

  it("can reuse an explicit persistent workspace", async () => {
    const workspaceId = `vitest-persistent-${Date.now()}`;
    const sandbox = new DockerSandbox({
      image: "node:22-bookworm",
      pull: "missing",
    });
    const first = await sandbox.createSession({
      id: `${workspaceId}-first`,
      workspace: {
        mode: "persistent",
        id: workspaceId,
      },
    });

    await first.writeTextFile("state.txt", "kept");
    await first.destroy();

    const second = await sandbox.createSession({
      id: `${workspaceId}-second`,
      workspace: {
        mode: "persistent",
        id: workspaceId,
        destroyOnSessionDestroy: true,
      },
    });

    try {
      await expect(second.readTextFile("state.txt")).resolves.toBe("kept");
    } finally {
      await second.destroy();
    }
  }, 60_000);
});
