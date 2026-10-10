import { beforeAll, describe, expect, it, vi } from "vitest";
import { runDockerCli } from "../src/docker-cli";
import { DockerSandboxClient } from "../src/docker-sandbox";
import { createDockerSandboxTools } from "../src/tools";

const runDockerTests = process.env.ANVIA_SANDBOX_DOCKER_TESTS === "1";
const image = "ghcr.io/astral-sh/uv:python3.13-trixie-slim";
const decoder = new TextDecoder("utf-8", { fatal: true });

async function dockerAvailable(): Promise<boolean> {
  try {
    const result = await runDockerCli(["info", "--format", "{{.ServerVersion}}"], {
      dockerPath: "docker",
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 && !result.timedOut;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "docker_unavailable")
      return false;
    throw error;
  }
}

const canRunDockerTests = runDockerTests && (await dockerAvailable());

describe.skipIf(!canRunDockerTests)("natural shell command lines on Debian", () => {
  const client = new DockerSandboxClient();

  beforeAll(async () => {
    await client.pullImage({ image });
  }, 120_000);

  it("provides bash even though /bin/sh resolves to dash", async () => {
    await using sandbox = await client.createSandbox({
      image,
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });

    const sh = await sandbox.runtime.exec({ command: "readlink", args: ["/bin/sh"] });
    expect(sh).toMatchObject({ status: "exited", exitCode: 0 });
    expect(decoder.decode(sh.stdout).trim()).toBe("dash");

    const bash = await sandbox.runtime.exec({ command: "/bin/bash", args: ["--version"] });
    expect(bash).toMatchObject({ status: "exited", exitCode: 0 });
    expect(decoder.decode(bash.stdout)).toContain("GNU bash");
  }, 30_000);

  it.each([
    {
      name: "expands braces into separate raw and results directories",
      command: "mkdir -p repro/{raw,results} && ls repro",
      stdout: "raw\nresults\n",
    },
    {
      name: "evaluates a bash conditional for an existing directory",
      command: "[[ -d repro ]] && echo ok",
      stdout: "ok\n",
    },
  ])(
    "$name",
    async ({ command, stdout }) => {
      await using sandbox = await client.createSandbox({
        image,
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        // Seed independently so the conditional does not depend on the brace-expansion test.
        directories: ["repro"],
        runtime: { commandTimeoutMs: 10_000, maxOutputBytes: 64_000 },
      });
      const [tool] = createDockerSandboxTools({
        sandbox: sandbox.runtime,
        tools: ["exec_command"],
      });
      if (tool === undefined) throw new Error("Expected exec_command tool.");

      const result = await tool.call({ command });

      expect(result).toMatchObject({ status: "exited", exitCode: 0, stdout, stderr: "" });
      expect(result).toMatchObject({ stdout: expect.not.stringContaining("{raw,results}") });
    },
    30_000,
  );

  it("starts a managed Bash command line with a Bash-only allowlist", async () => {
    const client = new DockerSandboxClient();
    await using sandbox = await client.createSandbox({
      image,
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    const [tool] = createDockerSandboxTools({
      sandbox: sandbox.runtime,
      tools: ["start_process"],
      exec: { commands: { mode: "allow", values: ["/bin/bash"], allowShellInterpreters: true } },
    });
    if (tool === undefined) throw new Error("Expected start_process tool.");
    const process = (await tool.call({
      command: "mkdir -p repro/{raw,results} && [[ -d repro/raw ]] && echo ok",
    })) as { id: string };
    await vi.waitFor(async () => {
      expect(await sandbox.runtime.listProcesses()).toContainEqual(
        expect.objectContaining({
          id: process.id,
          command: "/bin/bash",
          status: "exited",
          exitCode: 0,
        }),
      );
    });
    const logs = await sandbox.runtime.readProcessLogs({ processId: process.id });
    expect(decoder.decode(logs.stdout)).toBe("ok\n");
    expect(decoder.decode(logs.stderr)).toBe("");
    expect(
      (await sandbox.runtime.listFiles({ path: "repro" })).map((file) => file.path).sort(),
    ).toEqual(["repro/raw", "repro/results"]);
  }, 30_000);

  it("preserves explicit POSIX sh execution when Bash is installed", async () => {
    const client = new DockerSandboxClient();
    await using sandbox = await client.createSandbox({
      image,
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    const [tool] = createDockerSandboxTools({
      sandbox: sandbox.runtime,
      tools: ["exec_command"],
      exec: { commands: { mode: "allow", values: ["sh"], allowShellInterpreters: true } },
    });
    if (tool === undefined) throw new Error("Expected exec_command tool.");
    await expect(tool.call({ command: "echo ready" })).rejects.toMatchObject({
      code: "tool_policy",
    });
    await expect(
      tool.call({
        command: "sh",
        args: ["-c", "printf '%s\\n' repro/{raw,results}"],
      }),
    ).resolves.toMatchObject({
      status: "exited",
      exitCode: 0,
      stdout: "repro/{raw,results}\n",
      stderr: "",
    });
  }, 30_000);
});
