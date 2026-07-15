import { describe, expect, it } from "vitest";
import { DockerSandbox } from "../src/docker-sandbox";
import { SandboxPortError } from "../src/errors";

describe("DockerSandbox port validation", () => {
  it("rejects published ports while networking is disabled", async () => {
    const sandbox = new DockerSandbox({ pull: "never", network: false });

    await expect(sandbox.createSession({ ports: [5173] })).rejects.toThrow(SandboxPortError);
  });

  it("rejects invalid and duplicate published ports before using Docker", async () => {
    const sandbox = new DockerSandbox({ pull: "never", network: true });

    await expect(sandbox.createSession({ ports: [0] })).rejects.toThrow("1 to 65535");
    await expect(sandbox.createSession({ ports: [65_536] })).rejects.toThrow("1 to 65535");
    await expect(sandbox.createSession({ ports: [5173, 5173] })).rejects.toThrow("duplicated");
  });

  it("rejects Docker network modes that cannot publish ports", async () => {
    for (const network of ["none", "host", "container:another"] as const) {
      const sandbox = new DockerSandbox({ pull: "never", network });
      await expect(sandbox.createSession({ ports: [5173] })).rejects.toThrow(
        "bridge-capable Docker network",
      );
    }
  });
});
