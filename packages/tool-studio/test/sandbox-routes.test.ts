import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createStudioSandboxRegistry, registerSandboxRoutes } from "../src/runtime/sandboxes";
import type { StudioSandboxesSummary, StudioSandboxInspector } from "../src/types";

describe("Studio sandbox registration and routes", () => {
  it("uses only explicit registrations and records declared associations", () => {
    const inspector = createSandboxInspector();
    const registry = createStudioSandboxRegistry(
      [{ id: "coder" } as never, { id: "reviewer" } as never],
      [
        {
          inspector,
          agentIds: ["reviewer", "coder"],
          toolNames: ["read_file", "list_files"],
        },
      ],
    );

    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: "sandbox_1",
        provider: "test",
        workdir: "/workspace",
        agentIds: ["coder", "reviewer"],
        toolNames: ["list_files", "read_file"],
        capabilities: { files: true, ports: true, processes: true, views: false },
        views: [],
      }),
    ]);
    expect(() => createStudioSandboxRegistry([], [{ inspector }])).not.toThrow();
    expect(() =>
      createStudioSandboxRegistry([], [{ inspector }, { inspector: { ...inspector } }]),
    ).toThrow("duplicate provider/id");
  });

  it("serves read-only files, ports, processes, and strict UTF-8 logs", async () => {
    const inspector = createSandboxInspector();
    const app = sandboxApp(inspector);
    const listResponse = await app.request("http://studio.test/sandboxes");
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    const summary = (await listResponse.json()) as StudioSandboxesSummary;
    const ref = summary.sandboxes[0]?.ref;
    if (ref === undefined) throw new Error("Expected a sandbox reference");

    const files = await app.request(`http://studio.test/sandboxes/${ref}/files?path=.`);
    expect(await files.json()).toMatchObject({
      path: ".",
      entries: [
        { path: "src", type: "directory" },
        { path: "huge.bin", type: "file", size: 10 * 1024 * 1024 + 1 },
        { path: "readme.txt", type: "file", size: 5 },
      ],
    });
    expect(inspector.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ path: ".", abortSignal: expect.any(AbortSignal) }),
    );

    const content = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=readme.txt`,
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("application/octet-stream");
    expect(await content.text()).toBe("hello");
    expect(inspector.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "readme.txt", abortSignal: expect.any(AbortSignal) }),
    );
    expect(
      (await app.request(`http://studio.test/sandboxes/${ref}/files/content?path=huge.bin`)).status,
    ).toBe(413);

    expect(
      await (await app.request(`http://studio.test/sandboxes/${ref}/ports`)).json(),
    ).toMatchObject({
      ports: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    });
    expect(
      await (await app.request(`http://studio.test/sandboxes/${ref}/processes`)).json(),
    ).toMatchObject({ processes: [{ id: "process_1", status: "running" }] });

    const logs = await app.request(
      `http://studio.test/sandboxes/${ref}/processes/process_1/logs?tailBytes=4`,
    );
    expect(await logs.json()).toMatchObject({
      processId: "process_1",
      stdout: "ady\n",
      stderr: "",
      stdoutTruncated: true,
    });
    expect(inspector.readProcessLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: "process_1",
        tailBytes: 4,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects incomplete inspectors and unknown agent associations", () => {
    const inspector = createSandboxInspector();
    const listFiles = inspector.listFiles;
    if (listFiles === undefined) throw new Error("Expected file inspection.");
    expect(() =>
      createStudioSandboxRegistry(
        [],
        [
          {
            inspector: {
              id: inspector.id,
              provider: inspector.provider,
              workdir: inspector.workdir,
              listFiles,
            },
          },
        ],
      ),
    ).toThrow("both file inspector methods");
    expect(() => createStudioSandboxRegistry([], [{ inspector, agentIds: ["missing"] }])).toThrow(
      "unknown agent",
    );
  });

  it("returns unsupported capability responses for intentionally omitted views", async () => {
    const inspector: StudioSandboxInspector = {
      id: "ports_only",
      provider: "test",
      workdir: "/workspace",
      publishedPorts: [],
    };
    const app = sandboxApp(inspector);
    const summary = (await (
      await app.request("http://studio.test/sandboxes")
    ).json()) as StudioSandboxesSummary;
    const ref = summary.sandboxes[0]?.ref;
    if (ref === undefined) throw new Error("Expected a sandbox reference");

    expect((await app.request(`http://studio.test/sandboxes/${ref}/files`)).status).toBe(501);
    expect((await app.request(`http://studio.test/sandboxes/${ref}/processes`)).status).toBe(501);
  });

  it("maps unavailable owner state without exposing internals", async () => {
    const inspector = createSandboxInspector();
    const listFiles = inspector.listFiles;
    if (listFiles === undefined) throw new Error("Expected file inspection.");
    vi.mocked(listFiles).mockRejectedValueOnce(
      Object.assign(new Error("destroyed details"), { code: "invalid_state" }),
    );
    const app = sandboxApp(inspector);
    const summary = (await (
      await app.request("http://studio.test/sandboxes")
    ).json()) as StudioSandboxesSummary;
    const ref = summary.sandboxes[0]?.ref;
    if (ref === undefined) throw new Error("Expected a sandbox reference");
    const response = await app.request(`http://studio.test/sandboxes/${ref}/files`);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("destroyed details");
  });
});

function sandboxApp(inspector: StudioSandboxInspector): Hono {
  const app = new Hono();
  registerSandboxRoutes(app, createStudioSandboxRegistry([], [{ inspector }]));
  return app;
}

function createSandboxInspector(): StudioSandboxInspector {
  return {
    id: "sandbox_1",
    provider: "test",
    workdir: "/workspace",
    publishedPorts: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    listFiles: vi.fn(async (options?: { path?: string }) =>
      (options?.path ?? ".") === "."
        ? [
            { path: "readme.txt", type: "file" as const, size: 5 },
            { path: "src", type: "directory" as const, size: 0 },
            { path: "huge.bin", type: "file" as const, size: 10 * 1024 * 1024 + 1 },
          ]
        : [],
    ),
    readFile: vi.fn(async () => new TextEncoder().encode("hello")),
    listProcesses: vi.fn(async () => [
      {
        id: "process_1",
        command: "pnpm",
        args: ["dev"],
        status: "running" as const,
        startedAt: "2026-07-17T00:00:00.000Z",
      },
    ]),
    readProcessLogs: vi.fn(async () => ({
      stdout: new TextEncoder().encode("ready\n"),
      stderr: new Uint8Array(),
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
  };
}
