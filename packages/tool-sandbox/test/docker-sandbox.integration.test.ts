import { describe, expect, it } from "vitest";
import { DockerSandboxClient } from "../src/docker-sandbox";

const runDockerTests = process.env.ANVIA_SANDBOX_DOCKER_TESTS === "1";
const decoder = new TextDecoder("utf-8", { fatal: true });

describe.skipIf(!runDockerTests)("Docker sandbox integration", () => {
  it("creates, operates, resumes, and destroys an ephemeral sandbox", async () => {
    const id = `vitest-${Date.now()}`;
    const client = new DockerSandboxClient();
    await client.pullImage({ image: "node:22-bookworm" });
    let sandbox = await client.createSandbox({
      id,
      image: "node:22-bookworm",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
      directories: ["src"],
      files: { "src/index.js": "console.log('hello sandbox')" },
      runtime: { commandTimeoutMs: 10_000, maxOutputBytes: 64_000 },
    });

    try {
      await expect(
        client.createSandbox({
          id,
          image: "node:22-bookworm",
          workspace: { type: "ephemeral" },
          network: { mode: "none" },
        }),
      ).rejects.toMatchObject({ code: "invalid_state" });

      const result = await sandbox.runtime.exec({ command: "node", args: ["src/index.js"] });
      expect(result.status).toBe("exited");
      expect(decoder.decode(result.stdout).trim()).toBe("hello sandbox");

      await sandbox.runtime.exec({ command: "ln", args: ["-s", "/etc/hostname", "host-leak"] });
      await expect(sandbox.runtime.readFile({ path: "host-leak" })).rejects.toMatchObject({
        code: "invalid_path",
      });

      await sandbox.runtime.writeTextFile({ path: "state.txt", text: "kept" });
      await sandbox.stop();
      expect(sandbox.state).toBe("stopped");

      sandbox = await client.resumeSandbox({ id });
      await expect(sandbox.runtime.readTextFile({ path: "state.txt" })).resolves.toBe("kept");
      await expect(sandbox.runtime.listProcesses()).resolves.toEqual([]);
    } finally {
      await sandbox.destroy();
    }
    expect(sandbox.state).toBe("destroyed");
    await expect(client.resumeSandbox({ id })).rejects.toMatchObject({ code: "sandbox_not_found" });
  }, 120_000);

  it("streams byte output, reports timeout, and manages a published port", async () => {
    const client = new DockerSandboxClient();
    await client.pullImage({ image: "node:22-bookworm" });
    const id = `vitest-port-${Date.now()}`;
    let sandbox = await client.createSandbox({
      id,
      image: "node:22-bookworm",
      workspace: { type: "ephemeral" },
      network: { mode: "bridge", ports: [4310] },
      runtime: { commandTimeoutMs: 10_000, maxProcesses: 1 },
    });

    try {
      const events = [];
      for await (const event of sandbox.runtime.execStream({
        command: "node",
        args: ["-e", "console.log('one'); console.error('two')"],
      })) {
        events.push(event);
      }
      expect(events.at(-1)?.type).toBe("result");

      const timedOut = await sandbox.runtime.exec({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 10000)"],
        timeoutMs: 100,
      });
      expect(timedOut.status).toBe("timed_out");

      const process = await sandbox.runtime.startProcess({
        command: "node",
        args: [
          "-e",
          'require("node:http").createServer((_q,r)=>r.end("ok")).listen(4310,"0.0.0.0")',
        ],
      });
      const port = await sandbox.runtime.waitForPort({ containerPort: 4310, timeoutMs: 10_000 });
      expect(await (await fetch(`http://${port.host}:${port.hostPort}`)).text()).toBe("ok");
      await sandbox.runtime.stopProcess({ processId: process.id, gracePeriodMs: 2_000 });

      await sandbox.stop();
      sandbox = await client.resumeSandbox({ id });
      expect(sandbox.runtime.publishedPorts).toHaveLength(1);
      expect(sandbox.runtime.publishedPorts[0]?.containerPort).toBe(4310);

      const resumedProcess = await sandbox.runtime.startProcess({
        command: "node",
        args: [
          "-e",
          'require("node:http").createServer((_q,r)=>r.end("resumed")).listen(4310,"0.0.0.0")',
        ],
      });
      const resumedPort = await sandbox.runtime.waitForPort({
        containerPort: 4310,
        timeoutMs: 10_000,
      });
      expect(await (await fetch(`http://${resumedPort.host}:${resumedPort.hostPort}`)).text()).toBe(
        "resumed",
      );
      await sandbox.runtime.stopProcess({ processId: resumedProcess.id, gracePeriodMs: 2_000 });
    } finally {
      await sandbox.destroy();
    }
  }, 120_000);

  it("does not launch a process when startup is aborted before acknowledgement", async () => {
    const client = new DockerSandboxClient();
    await client.pullImage({ image: "node:22-bookworm" });
    await using sandbox = await client.createSandbox({
      id: `vitest-process-abort-${Date.now()}`,
      image: "node:22-bookworm",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
    });
    const controller = new AbortController();
    const starting = sandbox.runtime.startProcess({
      command: "sh",
      args: ["-c", "touch should-not-exist; sleep 999"],
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 1);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    await expect(sandbox.runtime.listFiles({ path: "." })).resolves.not.toContainEqual(
      expect.objectContaining({ path: "should-not-exist" }),
    );
    await expect(sandbox.runtime.listProcesses()).resolves.toEqual([]);
  }, 120_000);
});
