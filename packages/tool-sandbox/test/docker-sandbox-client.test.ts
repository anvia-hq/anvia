import { beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
  assert: vi.fn<(args: string[], options: unknown) => Promise<void>>(),
  run: vi.fn<(args: string[], options: unknown) => Promise<DockerResult>>(),
}));

vi.mock("../src/docker-cli", () => ({
  assertDockerCli: docker.assert,
  runDockerCli: docker.run,
  decodeUtf8: (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
}));

import { DockerSandboxClient } from "../src/docker-sandbox";

describe("DockerSandboxClient ownership", () => {
  beforeEach(() => {
    docker.assert.mockReset().mockResolvedValue(undefined);
    docker.run.mockReset().mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such container"), exitCode: 1 });
      }

      return dockerResult();
    });
  });

  it("creates without pulling and destroys its ephemeral volume", async () => {
    const client = new DockerSandboxClient();
    const sandbox = await client.createSandbox({
      id: "owned",
      image: "local:test",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });

    expect(docker.assert.mock.calls.map(([args]) => args[0])).toEqual(["volume", "run"]);
    expect(docker.assert.mock.calls.flatMap(([args]) => args)).not.toContain("pull");
    await sandbox.destroy();
    expect(docker.run).toHaveBeenCalledWith(["rm", "-f", "anvia-sandbox-owned"], {
      dockerPath: "docker",
    });
    expect(docker.run.mock.calls.map(([args]) => args)).toContainEqual([
      "volume",
      "rm",
      expect.stringMatching(/^anvia-sandbox-owned-workspace-/),
    ]);
    expect(sandbox.state).toBe("destroyed");
  });

  it('supports pull: "if-missing" and pull: "always" on createSandbox', async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such container"), exitCode: 1 });
      }

      if (args[0] === "image" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such image"), exitCode: 1 });
      }

      return dockerResult();
    });

    const client = new DockerSandboxClient();
    const pulledIfMissing = await client.createSandbox({
      id: "pull-missing",
      image: "remote:latest",
      pull: "if-missing",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    expect(docker.assert.mock.calls.map(([args]) => args[0])).toEqual(["pull", "volume", "run"]);
    await pulledIfMissing.destroy();

    docker.assert.mockClear();
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such container"), exitCode: 1 });
      }

      return dockerResult();
    });

    const skippedPull = await client.createSandbox({
      id: "pull-present",
      image: "remote:latest",
      pull: "if-missing",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    expect(docker.assert.mock.calls.map(([args]) => args[0])).toEqual(["volume", "run"]);
    await skippedPull.destroy();

    docker.assert.mockClear();
    const alwaysPull = await client.createSandbox({
      id: "pull-always",
      image: "remote:latest",
      pull: "always",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    expect(docker.assert.mock.calls.map(([args]) => args[0])).toEqual(["pull", "volume", "run"]);
    await alwaysPull.destroy();

    await expect(
      client.createSandbox({
        id: "pull-bad",
        image: "remote:latest",
        pull: "bogus" as never,
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
      }),
    ).rejects.toThrow(/pull must be/);
  });

  it("does not delete a caller-owned Docker volume", async () => {
    const client = new DockerSandboxClient();
    const sandbox = await client.createSandbox({
      id: "external",
      image: "local:test",
      workspace: { type: "docker-volume", name: "caller-data" },
      network: { mode: "none" },
    });
    await sandbox.destroy();

    expect(docker.run.mock.calls.map(([args]) => args)).not.toContainEqual([
      "volume",
      "rm",
      "caller-data",
    ]);
  });

  it("passes explicit shared memory and seccomp isolation to Docker", async () => {
    const client = new DockerSandboxClient();
    const sandbox = await client.createSandbox({
      id: "browser-isolation",
      image: "local:test",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
      resources: { sharedMemoryMb: 1024 },
      security: {
        dropCapabilities: ["ALL"],
        addCapabilities: ["SYS_CHROOT"],
        seccompProfile: { type: "path", path: "/opt/anvia/seccomp.json" },
      },
    });

    const run = docker.assert.mock.calls.find(([args]) => args[0] === "run")?.[0];
    expect(run).toEqual(
      expect.arrayContaining([
        "--shm-size",
        "1024m",
        "--security-opt",
        "seccomp=/opt/anvia/seccomp.json",
        "--cap-drop",
        "ALL",
        "--cap-add",
        "SYS_CHROOT",
      ]),
    );
    await sandbox.destroy();
  });

  it("only rolls back resources created before Docker run fails", async () => {
    docker.assert.mockImplementation(async (args) => {
      if (args[0] === "run") throw new Error("run failed");
    });
    const client = new DockerSandboxClient();

    await expect(
      client.createSandbox({
        id: "rollback",
        image: "local:test",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
      }),
    ).rejects.toThrow("run failed");
    expect(docker.run.mock.calls.map(([args]) => args)).not.toContainEqual([
      "rm",
      "-f",
      "anvia-sandbox-rollback",
    ]);
    expect(docker.run.mock.calls.map(([args]) => args)).toContainEqual([
      "volume",
      "rm",
      expect.stringMatching(/^anvia-sandbox-rollback-workspace-/),
    ]);
  });

  it("rejects a duplicate ID without mutating the existing sandbox", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true) });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();

    await expect(
      client.createSandbox({
        id: "resumed",
        image: "local:test",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(docker.assert).not.toHaveBeenCalled();
    expect(docker.run.mock.calls.map(([args]) => args)).not.toContainEqual([
      "rm",
      "-f",
      "anvia-sandbox-resumed",
    ]);
  });

  it("resumes with a fresh process registry and restarts a running container", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true) });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();
    const sandbox = await client.resumeSandbox({ id: "resumed" });

    expect(docker.assert.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
      ["stop", "anvia-sandbox-resumed"],
      ["start", "anvia-sandbox-resumed"],
    ]);
    await expect(sandbox.runtime.listProcesses()).resolves.toEqual([]);
    await sandbox.destroy();
  });

  it("recovers requested ports from stable configuration before restarting", async () => {
    let inspections = 0;
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        inspections += 1;
        return dockerResult({
          stdout:
            inspections === 1
              ? encodedInspection(false, [4310])
              : encodedInspection(true, [4310], 49152),
        });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();
    const sandbox = await client.resumeSandbox({ id: "resumed" });

    expect(sandbox.runtime.publishedPorts).toEqual([
      { containerPort: 4310, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" },
    ]);
    await sandbox.destroy();
  });

  it("refuses to write through a container symlink before docker cp", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true, [], undefined, "symlink-write") });
      }

      if (args[0] === "exec" && args.includes("anvia-write-path-check")) {
        return dockerResult({ exitCode: 1 });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();
    const sandbox = await client.resumeSandbox({ id: "symlink-write" });

    await expect(
      sandbox.runtime.writeTextFile({ path: "host-leak", text: "overwrite" }),
    ).rejects.toMatchObject({ code: "invalid_path" });
    expect(docker.assert.mock.calls.map(([args]) => args[0])).not.toContain("cp");
    await sandbox.destroy();
  });

  it("writes regular files after the container reports a writable path", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true, [], undefined, "regular-write") });
      }

      if (args[0] === "exec" && args.includes("anvia-write-path-check")) {
        return dockerResult({ exitCode: 0 });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();
    const sandbox = await client.resumeSandbox({ id: "regular-write" });

    await expect(
      sandbox.runtime.writeTextFile({ path: "notes.txt", text: "kept" }),
    ).resolves.toBeUndefined();
    expect(docker.assert.mock.calls.map(([args]) => args[0])).toContain("cp");
    await sandbox.destroy();
  });

  it("rejects a symlinked parent before creating directories or copying bytes", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true, [], undefined, "parent-write") });
      }

      if (args[0] === "exec" && args.includes("anvia-write-path-check")) {
        return dockerResult({ exitCode: 1 });
      }

      return dockerResult();
    });
    const sandbox = await new DockerSandboxClient().resumeSandbox({ id: "parent-write" });
    try {
      await expect(
        sandbox.runtime.writeTextFile({ path: "linkdir/new/file.txt", text: "blocked" }),
      ).rejects.toMatchObject({ code: "invalid_path" });
      expect(
        docker.run.mock.calls.some(([args]) => args[0] === "exec" && args.includes("mkdir")),
      ).toBe(false);
      expect(docker.assert.mock.calls.some(([args]) => args[0] === "cp")).toBe(false);
    } finally {
      await sandbox.destroy();
    }
  });

  it("fails closed when the path inspection command cannot run", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({
          stdout: encodedInspection(true, [], undefined, "failed-write-check"),
        });
      }

      if (args[0] === "exec" && args.includes("anvia-write-path-check")) {
        return dockerResult({ exitCode: 127 });
      }

      return dockerResult();
    });
    const sandbox = await new DockerSandboxClient().resumeSandbox({ id: "failed-write-check" });
    try {
      await expect(
        sandbox.runtime.writeTextFile({ path: "new/file.txt", text: "blocked" }),
      ).rejects.toMatchObject({ code: "docker_command_failed" });
      expect(
        docker.run.mock.calls.some(([args]) => args[0] === "exec" && args.includes("mkdir")),
      ).toBe(false);
      expect(docker.assert.mock.calls.some(([args]) => args[0] === "cp")).toBe(false);
    } finally {
      await sandbox.destroy();
    }
  });

  it("rechecks the write path after creating parent directories", async () => {
    let checks = 0;
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({
          stdout: encodedInspection(true, [], undefined, "changed-write-path"),
        });
      }

      if (args[0] === "exec" && args.includes("anvia-write-path-check")) {
        return dockerResult({ exitCode: ++checks === 1 ? 0 : 1 });
      }

      return dockerResult();
    });
    const sandbox = await new DockerSandboxClient().resumeSandbox({ id: "changed-write-path" });
    try {
      await expect(
        sandbox.runtime.writeTextFile({ path: "new/file.txt", text: "blocked" }),
      ).rejects.toMatchObject({ code: "invalid_path" });
      expect(
        docker.run.mock.calls.some(([args]) => args[0] === "exec" && args.includes("mkdir")),
      ).toBe(true);
      expect(docker.assert.mock.calls.some(([args]) => args[0] === "cp")).toBe(false);
    } finally {
      await sandbox.destroy();
    }
  });

  it("checks and ensures images without redundant pulls", async () => {
    const client = new DockerSandboxClient();
    await expect(client.hasImage({ image: "node:22-bookworm" })).resolves.toBe(true);
    await expect(client.ensureImage({ image: "node:22-bookworm" })).resolves.toEqual({
      pulled: false,
    });
    expect(docker.assert).not.toHaveBeenCalled();

    docker.run.mockResolvedValueOnce(
      dockerResult({
        exitCode: 1,
        stderr: new TextEncoder().encode("Error: No such image: node:99"),
      }),
    );
    await expect(client.ensureImage({ image: "node:99" })).resolves.toEqual({ pulled: true });
    expect(docker.assert).toHaveBeenCalledWith(["pull", "node:99"], {
      dockerPath: "docker",
      signal: undefined,
    });
  });

  it("classifies an unreachable Docker daemon as docker_unavailable with stderr", async () => {
    docker.run.mockResolvedValueOnce(
      dockerResult({
        exitCode: 1,
        stderr: new TextEncoder().encode(
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
        ),
      }),
    );
    const client = new DockerSandboxClient();

    await expect(client.hasImage({ image: "node:22-bookworm" })).rejects.toMatchObject({
      code: "docker_unavailable",
      message: expect.stringContaining("Cannot connect to the Docker daemon"),
    });
  });

  it("includes an actionable pull hint when an image is missing", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such container"), exitCode: 1 });
      }

      if (args[0] === "image" && args[1] === "inspect") {
        return dockerResult({ stderr: new TextEncoder().encode("No such image"), exitCode: 1 });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();

    await expect(
      client.createSandbox({
        id: "missing-image",
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
      }),
    ).rejects.toMatchObject({
      code: "image_not_found",
      message: expect.stringContaining("ensureImage"),
    });
  });

  it("lists managed sandboxes and destroys them by id", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "ps") {
        return dockerResult({
          stdout: new TextEncoder().encode(
            `${JSON.stringify({
              Names: "anvia-sandbox-orphan",
              Image: "node:22-bookworm",
              State: "exited",
              Status: "Exited (0) 2 hours ago",
              Labels:
                "anvia.sandbox.schema=1,anvia.sandbox.id=orphan,anvia.sandbox.workdir=/workspace,anvia.sandbox.workspace.type=ephemeral,anvia.sandbox.network.mode=none",
            })}\n`,
          ),
        });
      }

      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(false, [], undefined, "orphan") });
      }

      return dockerResult();
    });
    const client = new DockerSandboxClient();

    await expect(client.listSandboxes()).resolves.toEqual([
      {
        id: "orphan",
        containerName: "anvia-sandbox-orphan",
        image: "node:22-bookworm",
        state: "exited",
        status: "Exited (0) 2 hours ago",
        workdir: "/workspace",
        workspaceType: "ephemeral",
        networkMode: "none",
      },
    ]);

    await client.destroySandbox({ id: "orphan" });
    expect(docker.run).toHaveBeenCalledWith(["rm", "-f", "anvia-sandbox-orphan"], {
      dockerPath: "docker",
    });
    expect(docker.run).toHaveBeenCalledWith(["volume", "rm", "anvia-sandbox-resumed-workspace"], {
      dockerPath: "docker",
    });

    docker.run.mockResolvedValueOnce(
      dockerResult({ stderr: new TextEncoder().encode("No such container"), exitCode: 1 }),
    );
    await expect(
      client.destroySandbox({ id: "missing", ignoreNotFound: true }),
    ).resolves.toBeUndefined();
  });

  it("supports execText and workdir-absolute paths on DockerSandboxRuntime", async () => {
    docker.run.mockImplementation(async (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        return dockerResult({ stdout: encodedInspection(true, [], undefined, "text-exec") });
      }

      if (args[0] === "exec" && args.includes("echo")) {
        return dockerResult({ stdout: new TextEncoder().encode("hello\n") });
      }

      return dockerResult();
    });
    const sandbox = await new DockerSandboxClient().resumeSandbox({ id: "text-exec" });
    try {
      await expect(
        sandbox.runtime.execText({ command: "echo", args: ["hello"], cwd: "/workspace" }),
      ).resolves.toMatchObject({ status: "exited", exitCode: 0, stdout: "hello\n", stderr: "" });
      await expect(
        sandbox.runtime.writeTextFile({ path: "/workspace/notes/a.txt", text: "ok" }),
      ).resolves.toBeUndefined();
    } finally {
      await sandbox.destroy();
    }
  });
});

type DockerResult = {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

function dockerResult(overrides: Partial<DockerResult> = {}): DockerResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function encodedInspection(
  running: boolean,
  ports: readonly number[] = [],
  hostPort?: number,
  id = "resumed",
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      {
        Config: {
          Labels: {
            "anvia.sandbox.schema": "1",
            "anvia.sandbox.id": id,
            "anvia.sandbox.workdir": "/workspace",
            "anvia.sandbox.workspace.type": "ephemeral",
            "anvia.sandbox.workspace.volume": "anvia-sandbox-resumed-workspace",
            "anvia.sandbox.network.mode": ports.length === 0 ? "none" : "bridge",
            "anvia.sandbox.runtime.command-timeout-ms": "30000",
            "anvia.sandbox.runtime.max-output-bytes": "1048576",
            "anvia.sandbox.runtime.max-file-bytes": "10485760",
            "anvia.sandbox.runtime.max-processes": "4",
          },
        },
        HostConfig: {
          PortBindings: Object.fromEntries(
            ports.map((port) => [`${port}/tcp`, [{ HostIp: "127.0.0.1", HostPort: "" }]]),
          ),
        },
        State: { Running: running, Paused: false, Dead: false, Status: "running" },
        NetworkSettings: {
          Ports:
            hostPort === undefined
              ? {}
              : Object.fromEntries(
                  ports.map((port) => [
                    `${port}/tcp`,
                    [{ HostIp: "127.0.0.1", HostPort: `${hostPort}` }],
                  ]),
                ),
        },
      },
    ]),
  );
}
