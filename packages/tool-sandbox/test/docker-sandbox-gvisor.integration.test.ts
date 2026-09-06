import { describe, expect, it } from "vitest";
import { DockerSandboxClient } from "../src/docker-sandbox";

const runGvisorTests = process.env.ANVIA_SANDBOX_GVISOR_TESTS === "1";
const decoder = new TextDecoder("utf-8", { fatal: true });

describe.skipIf(!runGvisorTests)("gVisor sandbox integration", () => {
  it("creates, operates, resumes, and destroys a runsc sandbox", async () => {
    const id = `vitest-gvisor-${Date.now()}`;
    const client = new DockerSandboxClient();
    await client.pullImage({ image: "debian:bookworm-slim" });
    let sandbox = await client.createSandbox({
      id,
      image: "debian:bookworm-slim",
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
      containerRuntime: "runsc",
      runtime: { commandTimeoutMs: 10_000, maxOutputBytes: 64_000 },
    });

    try {
      expect(sandbox.inspector({ files: true }).containerRuntime).toBe("runsc");

      const result = await sandbox.runtime.exec({
        command: "sh",
        args: ["-c", "echo hello-gvisor"],
      });
      expect(result.status).toBe("exited");
      expect(decoder.decode(result.stdout).trim()).toBe("hello-gvisor");
      // Guards against the --runtime flag silently dropping from createRunArgs:
      // dmesg prints the gVisor banner only when the container really runs under runsc.
      const kernel = await sandbox.runtime.exec({ command: "dmesg" });
      expect(decoder.decode(kernel.stdout)).toContain("Starting gVisor");

      await sandbox.runtime.writeTextFile({ path: "state.txt", text: "kept" });
      await sandbox.stop();
      sandbox = await client.resumeSandbox({ id });
      await expect(sandbox.runtime.readTextFile({ path: "state.txt" })).resolves.toBe("kept");
      expect(sandbox.inspector({ files: true }).containerRuntime).toBe("runsc");
    } finally {
      await sandbox.destroy();
    }
    expect(sandbox.state).toBe("destroyed");
    await expect(client.resumeSandbox({ id })).rejects.toMatchObject({
      code: "sandbox_not_found",
    });
  }, 180_000);
});
