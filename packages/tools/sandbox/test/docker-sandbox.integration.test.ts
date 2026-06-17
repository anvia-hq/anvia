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
        timeoutMs: 500,
      },
    });
    const session = await sandbox.createSession({ id: `timeout-${Date.now()}` });

    try {
      const result = await session.exec({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 10_000)"],
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

      expect(events.map((event) => event.type)).toEqual(["stdout", "stderr", "exit"]);
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
    await session.destroy();

    expect(events).toEqual([
      `create:${session.id}`,
      "write:out/result.txt:2",
      "exec:start:node",
      "exec:end:0",
      `destroy:${session.id}`,
    ]);
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
