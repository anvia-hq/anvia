import { describe, expect, it, vi } from "vitest";
import { DockerBrowserClient } from "../src/docker-browser";

describe("DockerBrowserClient", () => {
  it("does no constructor I/O and pulls only when explicitly requested", async () => {
    const sandboxClient = fakeSandboxClient();
    const client = new DockerBrowserClient({
      sandboxClient: sandboxClient.client,
      image: "browser:test",
    });
    expect(sandboxClient.pullImage).not.toHaveBeenCalled();
    expect(sandboxClient.createSandbox).not.toHaveBeenCalled();

    await client.pullImage();
    expect(sandboxClient.pullImage).toHaveBeenCalledWith({ image: "browser:test" });
  });

  it("provisions fixed loopback services and configures the password through stdin", async () => {
    const sandboxClient = fakeSandboxClient();
    const client = new DockerBrowserClient({
      sandboxClient: sandboxClient.client,
      image: "browser:test",
    });
    const browser = await client.createBrowser({
      id: "browser-one",
      workspace: { type: "ephemeral" },
      network: { mode: "bridge" },
      desktop: {
        protocol: "novnc",
        password: "passw0rd",
        viewport: { width: 1440, height: 900 },
      },
    });

    expect(sandboxClient.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "browser:test",
        network: { mode: "bridge", ports: [9222, 6080] },
        user: "pwuser",
        resources: { sharedMemoryMb: 1024 },
        security: expect.objectContaining({
          noNewPrivileges: true,
          dropCapabilities: ["ALL"],
          addCapabilities: ["SYS_CHROOT"],
          seccompProfile: expect.objectContaining({ type: "path" }),
        }),
      }),
    );
    expect(sandboxClient.runtime.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/usr/local/bin/anvia-browser-configure",
        input: JSON.stringify({ password: "passw0rd", width: 1440, height: 900 }),
      }),
    );
    expect(sandboxClient.runtime.startProcess).toHaveBeenCalledWith({
      command: "/usr/local/bin/anvia-browser-start",
    });
    expect(browser.desktop).toMatchObject({ protocol: "novnc", containerPort: 6080 });
  });

  it("retries transient HTTP failures while waiting for browser readiness", async () => {
    const sandboxClient = fakeSandboxClient();
    const client = new DockerBrowserClient({
      sandboxClient: sandboxClient.client,
      image: "browser:test",
    });
    const browser = await client.createBrowser({
      workspace: { type: "ephemeral" },
      network: { mode: "bridge" },
      desktop: {
        protocol: "novnc",
        password: "passw0rd",
        viewport: { width: 1440, height: 900 },
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetch);

    try {
      await browser.waitUntilReady({ timeoutMs: 1_000 });
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects VNC values that x11vnc would truncate", async () => {
    const sandboxClient = fakeSandboxClient();
    const client = new DockerBrowserClient({
      sandboxClient: sandboxClient.client,
      image: "browser:test",
    });
    await expect(
      client.createBrowser({
        workspace: { type: "ephemeral" },
        network: { mode: "bridge" },
        desktop: {
          protocol: "novnc",
          password: "long-password",
          viewport: { width: 1440, height: 900 },
        },
      }),
    ).rejects.toThrow("exactly 8");
    expect(sandboxClient.createSandbox).not.toHaveBeenCalled();
  });
});

function fakeSandboxClient() {
  const runtime = {
    publishedPorts: [
      { containerPort: 9222, host: "127.0.0.1", hostPort: 49100, protocol: "tcp" },
      { containerPort: 6080, host: "127.0.0.1", hostPort: 49101, protocol: "tcp" },
    ],
    exec: vi.fn(async () => ({
      status: "exited",
      exitCode: 0,
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      durationMs: 1,
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    startProcess: vi.fn(async () => ({
      id: "process",
      command: "/usr/local/bin/anvia-browser-start",
      args: [],
      status: "running",
      startedAt: new Date().toISOString(),
    })),
    waitForPort: vi.fn(),
  };
  const sandbox = {
    id: "browser-one",
    state: "running",
    runtime,
    inspector: vi.fn(() => ({ id: "browser-one", provider: "docker", workdir: "/workspace" })),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
  const pullImage = vi.fn();
  const createSandbox = vi.fn(async () => sandbox);
  const resumeSandbox = vi.fn(async () => sandbox);
  return {
    client: { pullImage, createSandbox, resumeSandbox } as never,
    pullImage,
    createSandbox,
    resumeSandbox,
    runtime,
    sandbox,
  };
}
