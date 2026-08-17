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
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      {
        Config: {
          Labels: {
            "anvia.sandbox.schema": "1",
            "anvia.sandbox.id": "resumed",
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
