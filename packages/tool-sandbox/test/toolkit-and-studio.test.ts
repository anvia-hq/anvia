import { isToolkit } from "@anvia/core/tool";
import { describe, expect, it, vi } from "vitest";
import { desktopToolkit, sandboxToolkit, studioSandbox } from "../src/index";
import type { SandboxDesktop } from "../src/remote/desktop";
import { STUDIO_SANDBOX_SYMBOL, type StudioSandboxToolMetadata } from "../src/studio-metadata";
import type { DockerSandbox, SandboxRuntime } from "../src/types";

function fakeRuntime(id = "sb-1"): SandboxRuntime {
  return {
    id,
    provider: "remote",
    workdir: "/workspace",
    publishedPorts: Object.freeze([]),
    exec: vi.fn(),
    execText: vi.fn(),
    execStream: vi.fn(),
    readFile: vi.fn(async () => new Uint8Array()),
    readTextFile: vi.fn(),
    readTextFilePage: vi.fn(),
    writeFile: vi.fn(),
    writeTextFile: vi.fn(),
    listFiles: vi.fn(async () => []),
    listProcesses: vi.fn(async () => []),
    startProcess: vi.fn(),
    readProcessLogs: vi.fn(async () => ({
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
    stopProcess: vi.fn(),
    waitForPort: vi.fn(),
  } as unknown as SandboxRuntime;
}

function fakeDockerSandbox(id = "docker-1"): DockerSandbox {
  const runtime = {
    ...fakeRuntime(id),
    provider: "docker",
    publishedPorts: Object.freeze([
      { containerPort: 3000, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" as const },
    ]),
  };
  return {
    id,
    state: "running",
    runtime,
    stop: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    inspector: vi.fn((opts) => {
      const result: Record<string, unknown> = {
        id,
        provider: "docker",
        workdir: "/workspace",
        containerRuntime: "default",
      };

      if (opts.files) {
        result.listFiles = runtime.listFiles;
        result.readFile = runtime.readFile;
      }

      if (opts.ports) {
        result.publishedPorts = runtime.publishedPorts;
      }

      if (opts.processes) {
        result.listProcesses = runtime.listProcesses;
        result.readProcessLogs = runtime.readProcessLogs;
      }

      return result;
    }),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  } as unknown as DockerSandbox;
}

function fakeRemoteDesktop(id = "sb-1"): SandboxDesktop {
  return {
    id,
    provider: "remote",
    workdir: "/workspace",
    status: vi.fn(async () => ({ running: true, width: 1280, height: 720, vncPort: 5900 })),
    start: vi.fn(async () => ({ running: true, width: 1280, height: 720, vncPort: 5900 })),
    resize: vi.fn(),
    screenshot: vi.fn(),
    cursorPosition: vi.fn(),
    act: vi.fn(),
    control: vi.fn(async () => ({ held: false })),
    takeover: vi.fn(),
    release: vi.fn(),
    openViewer: vi.fn(),
  } as unknown as SandboxDesktop;
}

describe("sandboxToolkit, desktopToolkit, and polymorphic studioSandbox", () => {
  it("builds a Toolkit with include, prefix, requiresApproval, and preserves Studio metadata", () => {
    const sandbox = fakeDockerSandbox("doc-1");
    const kit = sandboxToolkit({
      sandbox,
      include: ["exec_command", "read_file"],
      prefix: "sb_",
      requiresApproval: { exec_command: true },
      studio: { disposeOnShutdown: true },
    });

    expect(isToolkit(kit)).toBe(true);
    expect(kit.name).toBe("sandbox");
    expect(kit.tools.map((tool) => tool.name)).toEqual(["sb_exec_command", "sb_read_file"]);
    expect(kit.tools[0]!.requiresApproval).toBe(true);
    expect(kit.tools[1]!.requiresApproval).toBeUndefined();

    const meta = (kit.tools[0] as unknown as Record<PropertyKey, unknown>)[
      STUDIO_SANDBOX_SYMBOL
    ] as StudioSandboxToolMetadata | undefined;
    expect(meta).toBeDefined();

    const reg = meta!.getStudioSandbox();
    expect(reg.inspector).toMatchObject({ id: "doc-1", provider: "docker", workdir: "/workspace" });
    expect(typeof reg.dispose).toBe("function");
  });

  it("omits Studio metadata when studio: false is set", () => {
    const kit = sandboxToolkit({
      sandbox: fakeRuntime("sb-no-studio"),
      studio: false,
    });
    const meta = (kit.tools[0] as unknown as Record<PropertyKey, unknown>)[STUDIO_SANDBOX_SYMBOL];
    expect(meta).toBeUndefined();
  });

  it("builds desktopToolkit with ToolkitOptions and attaches desktop view metadata", () => {
    const desktop = fakeRemoteDesktop("desk-1");
    const kit = desktopToolkit({
      sandbox: desktop,
      include: ["desktop_screenshot", "desktop_click"],
      requiresApproval: { desktop_click: true },
      studio: { id: "screen", label: "Main Screen" },
    });

    expect(isToolkit(kit)).toBe(true);
    expect(kit.tools.map((tool) => tool.name)).toEqual(["desktop_screenshot", "desktop_click"]);
    expect(kit.tools[1]!.requiresApproval).toBe(true);

    const meta = (kit.tools[0] as unknown as Record<PropertyKey, unknown>)[
      STUDIO_SANDBOX_SYMBOL
    ] as StudioSandboxToolMetadata | undefined;
    expect(meta).toBeDefined();

    const reg = meta!.getStudioSandbox();
    expect(reg.inspector).toMatchObject({ id: "desk-1", provider: "remote" });
    expect(reg.views?.[0]).toMatchObject({ id: "screen", label: "Main Screen" });
  });

  it("supports studioSandbox(dockerSandbox) and studioSandbox(runtime) with disposeOnShutdown", async () => {
    const docker = fakeDockerSandbox("doc-2");
    const reg = studioSandbox(docker, {
      agentIds: ["coder"],
      toolNames: ["exec_command"],
      disposeOnShutdown: true,
    });

    expect(reg.inspector).toMatchObject({
      id: "doc-2",
      provider: "docker",
      workdir: "/workspace",
    });
    expect(reg.agentIds).toEqual(["coder"]);
    expect(reg.toolNames).toEqual(["exec_command"]);
    expect(typeof reg.dispose).toBe("function");

    await reg.dispose!();
    expect(docker.destroy).toHaveBeenCalledTimes(1);

    const runtimeReg = studioSandbox(fakeRuntime("rem-2"));
    expect(runtimeReg.inspector).toMatchObject({
      id: "rem-2",
      provider: "remote",
      workdir: "/workspace",
    });
    expect(runtimeReg.inspector.publishedPorts).toBeUndefined();
    expect(runtimeReg.dispose).toBeUndefined();

    expect(() =>
      sandboxToolkit({
        sandbox: fakeRuntime("rem-3"),
        studio: { disposeOnShutdown: true },
      }),
    ).toThrow(/DockerSandbox/);

    expect(() => studioSandbox(fakeRuntime("rem-4"), { disposeOnShutdown: true })).toThrow(
      /DockerSandbox/,
    );
  });
});
