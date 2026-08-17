import { describe, expect, it } from "vitest";
import { DockerSandboxClient } from "../src/docker-sandbox";
import { DockerSandboxError } from "../src/errors";

describe("DockerSandboxClient validation", () => {
  it("constructs without Docker I/O", () => {
    expect(
      () => new DockerSandboxClient({ dockerPath: "/definitely/missing/docker" }),
    ).not.toThrow();
  });

  it("rejects invalid workspace and network combinations before Docker I/O", async () => {
    const client = new DockerSandboxClient({ dockerPath: "/definitely/missing/docker" });

    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "legacy" },
        network: { mode: "none" },
      } as never),
    ).rejects.toThrow("workspace");
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "bridge", ports: [0] },
      }),
    ).rejects.toMatchObject({ code: "port" });
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "bridge", ports: [5173, 5173] },
      }),
    ).rejects.toThrow("duplicated");
  });

  it("rejects reserved labels and unsafe initial paths before Docker I/O", async () => {
    const client = new DockerSandboxClient({ dockerPath: "/definitely/missing/docker" });
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        labels: { "anvia.sandbox.id": "spoofed" },
      }),
    ).rejects.toThrow("reserved");
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        files: { "../secret": "no" },
      }),
    ).rejects.toBeInstanceOf(DockerSandboxError);
  });

  it("rejects oversized initial files before provisioning", async () => {
    const client = new DockerSandboxClient({ dockerPath: "/definitely/missing/docker" });
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        runtime: { maxFileBytes: 1 },
        files: { "large.txt": "xx" },
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("rejects invalid shared memory and seccomp configuration before Docker I/O", async () => {
    const client = new DockerSandboxClient({ dockerPath: "/definitely/missing/docker" });
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        resources: { sharedMemoryMb: 0 },
      }),
    ).rejects.toThrow("sharedMemoryMb");
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        security: { seccompProfile: { type: "path", path: "relative.json" } },
      }),
    ).rejects.toThrow("absolute host path");
    await expect(
      client.createSandbox({
        image: "node:22-bookworm",
        workspace: { type: "ephemeral" },
        network: { mode: "none" },
        security: { addCapabilities: ["SYS_CHROOT", "SYS_CHROOT"] },
      }),
    ).rejects.toThrow("addCapabilities contains a duplicate");
  });
});
