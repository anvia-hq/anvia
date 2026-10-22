import { DockerSandboxClient } from "../src/docker-sandbox";
import { describeSandboxRuntimeConformance } from "./conformance/suite";
import { createRemoteHarness } from "./support/remote-harness";

const runDockerTests = process.env.ANVIA_SANDBOX_DOCKER_TESTS === "1";
const image = process.env.ANVIA_SANDBOX_TEST_IMAGE ?? "node:22-bookworm";

describeSandboxRuntimeConformance("Docker", {
  skip: !runDockerTests,
  timeoutMs: 60_000,
  async create(limits) {
    const client = new DockerSandboxClient();
    await client.pullImage({ image });
    const sandbox = await client.createSandbox({
      id: `vitest-conformance-${Date.now()}`,
      image,
      workspace: { type: "ephemeral" },
      network: { mode: "none" },
      runtime: limits,
    });
    return { runtime: sandbox.runtime, cleanup: () => sandbox.destroy() };
  },
});

describeSandboxRuntimeConformance("Remote", {
  skip: process.platform === "win32",
  async create(limits) {
    const harness = await createRemoteHarness({ limits });
    return { runtime: harness.runtime, cleanup: () => harness.cleanup() };
  },
});
