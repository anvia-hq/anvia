import { type AnyTool, ToolSet } from "@anvia/core/tool";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createStudioSandboxRegistry, registerSandboxRoutes } from "../src/runtime/sandboxes";
import type { StudioAgent, StudioSandboxesSummary } from "../src/types";

const sandboxMetadataKey = Symbol.for("anvia.sandbox.tool.metadata");

describe("Studio sandbox discovery and routes", () => {
  it("deduplicates bound sessions and records their agent and tool associations", () => {
    const session = createSandboxSession();
    const registry = createStudioSandboxRegistry([
      createStudioAgent("coder", [
        sandboxTool("read_file", session),
        sandboxTool("list_files", session),
      ]),
      createStudioAgent("reviewer", [sandboxTool("inspect_workspace", session)]),
    ]);

    expect(registry.size).toBe(1);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: "sandbox_1",
        provider: "test",
        workdir: "/workspace",
        agentIds: ["coder", "reviewer"],
        toolNames: ["inspect_workspace", "list_files", "read_file"],
        capabilities: { files: true, ports: true, processes: true },
      }),
    ]);
    expect(registry.list()[0]?.ref).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("serves read-only files, ports, processes, and bounded logs", async () => {
    const session = createSandboxSession();
    const app = sandboxApp(session);

    const listResponse = await app.request("http://studio.test/sandboxes");
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    const summary = (await listResponse.json()) as StudioSandboxesSummary;
    const ref = summary.sandboxes[0]?.ref;
    expect(ref).toBeDefined();
    if (ref === undefined) throw new Error("Expected a sandbox reference");

    const detail = await app.request(`http://studio.test/sandboxes/${ref}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: "sandbox_1", provider: "test" });

    const files = await app.request(`http://studio.test/sandboxes/${ref}/files?path=.`);
    expect(files.status).toBe(200);
    expect(await files.json()).toMatchObject({
      path: ".",
      entries: [
        { path: "src", type: "directory" },
        { path: "huge.bin", type: "file", size: 10 * 1024 * 1024 + 1 },
        { path: "readme.txt", type: "file", size: 5 },
      ],
    });

    const content = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=readme.txt`,
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("application/octet-stream");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await content.text()).toBe("hello");
    expect(session.readFile).toHaveBeenCalledWith("readme.txt");

    const download = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=readme.txt&download=1`,
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");

    const directory = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=src`,
    );
    expect(directory.status).toBe(400);

    const traversal = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=..%2Fsecret`,
    );
    expect(traversal.status).toBe(400);

    const tooLarge = await app.request(
      `http://studio.test/sandboxes/${ref}/files/content?path=huge.bin`,
    );
    expect(tooLarge.status).toBe(413);
    expect(session.readFile).toHaveBeenCalledTimes(2);

    const ports = await app.request(`http://studio.test/sandboxes/${ref}/ports`);
    expect(await ports.json()).toMatchObject({
      ports: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    });

    const processes = await app.request(`http://studio.test/sandboxes/${ref}/processes`);
    expect(await processes.json()).toMatchObject({
      processes: [{ id: "process_1", command: "pnpm", status: "running" }],
    });

    const logs = await app.request(
      `http://studio.test/sandboxes/${ref}/processes/process_1/logs?tailBytes=512`,
    );
    expect(logs.headers.get("cache-control")).toBe("no-store");
    expect(await logs.json()).toMatchObject({
      processId: "process_1",
      stdout: "ready\n",
      stderr: "",
    });
    expect(session.readProcessLogs).toHaveBeenCalledWith("process_1", { tailBytes: 512 });

    const boundedLogs = await app.request(
      `http://studio.test/sandboxes/${ref}/processes/process_1/logs?tailBytes=4`,
    );
    expect(await boundedLogs.json()).toMatchObject({
      stdout: "ady\n",
      stdoutTruncated: true,
    });

    const invalidLogs = await app.request(
      `http://studio.test/sandboxes/${ref}/processes/process_1/logs?tailBytes=1048577`,
    );
    expect(invalidLogs.status).toBe(400);
  });

  it("reports unavailable sessions and unsupported optional capabilities", async () => {
    const destroyed = Object.assign(createSandboxSession(), {
      publishedPorts: undefined,
      listProcesses: undefined,
      readProcessLogs: undefined,
      listFiles: vi.fn(async () => {
        const error = new Error("destroyed");
        error.name = "SandboxSessionDestroyedError";
        throw error;
      }),
    });
    const app = sandboxApp(destroyed);
    const summary = (await (
      await app.request("http://studio.test/sandboxes")
    ).json()) as StudioSandboxesSummary;
    const ref = summary.sandboxes[0]?.ref;
    if (ref === undefined) throw new Error("Expected a sandbox reference");

    expect((await app.request(`http://studio.test/sandboxes/${ref}/files`)).status).toBe(409);
    expect((await app.request(`http://studio.test/sandboxes/${ref}/ports`)).status).toBe(501);
    expect((await app.request(`http://studio.test/sandboxes/${ref}/processes`)).status).toBe(501);
    expect((await app.request("http://studio.test/sandboxes/missing")).status).toBe(404);
  });
});

function sandboxApp(session: object): Hono {
  const registry = createStudioSandboxRegistry([
    createStudioAgent("coder", [sandboxTool("list_files", session)]),
  ]);
  const app = new Hono();
  registerSandboxRoutes(app, registry);
  return app;
}

function createStudioAgent(id: string, tools: AnyTool[]): StudioAgent {
  return {
    id,
    agent: {
      toolSet: ToolSet.fromTools(tools),
      dynamicTools: [],
    },
  } as unknown as StudioAgent;
}

function sandboxTool(name: string, session: object): AnyTool {
  const tool: AnyTool = {
    name,
    definition: () => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    }),
    call: () => "ok",
  };
  Object.defineProperty(tool, sandboxMetadataKey, {
    value: { session },
    enumerable: false,
  });
  return tool;
}

function createSandboxSession() {
  return {
    id: "sandbox_1",
    provider: "test",
    workdir: "/workspace",
    publishedPorts: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
    listFiles: vi.fn(async (filePath = ".") => {
      if (filePath === ".") {
        return [
          { path: "readme.txt", type: "file", size: 5 },
          { path: "src", type: "directory", size: 0 },
          { path: "huge.bin", type: "file", size: 10 * 1024 * 1024 + 1 },
        ];
      }
      return [];
    }),
    readFile: vi.fn(async () => new TextEncoder().encode("hello")),
    listProcesses: vi.fn(async () => [
      {
        id: "process_1",
        command: "pnpm",
        args: ["dev"],
        status: "running",
        startedAt: "2026-07-17T00:00:00.000Z",
      },
    ]),
    readProcessLogs: vi.fn(async () => ({
      stdout: "ready\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
  };
}
