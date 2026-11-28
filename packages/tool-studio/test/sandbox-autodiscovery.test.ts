import { Agent, type CompletionModel, createTool, createToolkit, Usage } from "@anvia/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Studio } from "../src";
import type { StudioSandboxRegistration } from "../src/types";

const studioSandboxSymbol = Symbol.for("anvia.studio.sandbox");

function createFakeModel(): CompletionModel {
  return {
    provider: "fake",
    modelId: "fake-1",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    async completion() {
      return {
        choice: [{ type: "text", text: "ok" }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  };
}

function attachSandboxMeta(tool: object, registration: StudioSandboxRegistration): void {
  Object.defineProperty(tool, studioSandboxSymbol, {
    value: {
      getStudioSandbox: () => registration,
    },
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

describe("Studio sandbox auto-discovery and shutdown disposal", () => {
  it("auto-discovers sandboxes, agentIds, prefixed toolNames, and merges desktop views across tools", async () => {
    const dispose = vi.fn(async () => undefined);
    const execTool = createTool({
      name: "exec_command",
      description: "Run command",
      inputSchema: z.object({}),
      handler: () => "ok",
    });
    const clickTool = createTool({
      name: "desktop_click",
      description: "Click desktop",
      inputSchema: z.object({}),
      handler: () => "ok",
    });

    attachSandboxMeta(execTool, {
      inspector: {
        id: "sb-1",
        provider: "remote",
        workdir: "/workspace",
        listFiles: async () => [],
        readFile: async () => new Uint8Array(),
        listProcesses: async () => [],
        readProcessLogs: async () => ({
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      },
      dispose,
    });

    attachSandboxMeta(clickTool, {
      inspector: {
        id: "sb-1",
        provider: "remote",
        workdir: "/workspace",
      },
      views: [
        {
          id: "desktop",
          label: "Desktop",
          source: {
            protocol: "novnc",
            connect: vi.fn(),
            control: {
              snapshot: async () => ({ mode: "agent" }),
              acquireHumanControl: vi.fn(),
            },
          },
          access: { mode: "local" },
          authentication: { type: "none" },
        },
      ],
    });

    const prefixedToolkit = createToolkit(
      { name: "sandbox", tools: [execTool] },
      { prefix: "dev_" },
    );

    const agent = new Agent({
      id: "builder",
      model: createFakeModel(),
      tools: [prefixedToolkit, clickTool],
    });

    const studio = new Studio([agent]);
    const listResponse = await studio.fetch(new Request("http://localhost/sandboxes"));
    expect(listResponse.status).toBe(200);
    const body = (await listResponse.json()) as {
      sandboxes: {
        id: string;
        provider: string;
        agentIds: string[];
        toolNames: string[];
        capabilities: { files: boolean; processes: boolean; views: boolean };
      }[];
    };

    expect(body.sandboxes).toHaveLength(1);
    expect(body.sandboxes[0]).toMatchObject({
      id: "sb-1",
      provider: "remote",
      agentIds: ["builder"],
      toolNames: ["desktop_click", "dev_exec_command"],
      capabilities: { files: true, processes: true, views: true },
    });

    studio.close();
    expect(dispose).not.toHaveBeenCalled();

    await studio.shutdown();
    await studio.shutdown();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("inherits discovered views on explicit override unless views: [] opts out, and filters foreign agentIds", async () => {
    const clickTool = createTool({
      name: "desktop_click",
      description: "Click desktop",
      inputSchema: z.object({}),
      handler: () => "ok",
    });

    attachSandboxMeta(clickTool, {
      inspector: {
        id: "sb-3",
        provider: "remote",
        workdir: "/workspace",
      },
      agentIds: ["foreign-agent"],
      views: [
        {
          id: "desktop",
          label: "Desktop",
          source: {
            protocol: "novnc",
            connect: vi.fn(),
            control: {
              snapshot: async () => ({ mode: "agent" }),
              acquireHumanControl: vi.fn(),
            },
          },
          access: { mode: "local" },
          authentication: { type: "none" },
        },
      ],
    });

    const agent = new Agent({
      id: "operator",
      model: createFakeModel(),
      tools: [clickTool],
    });

    const inheritViewsStudio = new Studio([agent], {
      sandboxes: [
        {
          inspector: {
            id: "sb-3",
            provider: "remote",
            workdir: "/custom",
            listFiles: async () => [],
            readFile: async () => new Uint8Array(),
          },
        },
      ],
    });
    const inherited = (await (
      await inheritViewsStudio.fetch(new Request("http://localhost/sandboxes"))
    ).json()) as {
      sandboxes: {
        workdir: string;
        agentIds: string[];
        capabilities: { files: boolean; views: boolean };
      }[];
    };
    expect(inherited.sandboxes[0]).toMatchObject({
      workdir: "/custom",
      agentIds: ["operator"],
      capabilities: { files: true, views: true },
    });

    const disableViewsStudio = new Studio([agent], {
      sandboxes: [
        {
          inspector: {
            id: "sb-3",
            provider: "remote",
            workdir: "/custom",
            listFiles: async () => [],
            readFile: async () => new Uint8Array(),
          },
          views: [],
        },
      ],
    });
    const disabled = (await (
      await disableViewsStudio.fetch(new Request("http://localhost/sandboxes"))
    ).json()) as {
      sandboxes: { capabilities: { views: boolean } }[];
    };
    expect(disabled.sandboxes[0]?.capabilities.views).toBe(false);
  });

  it("respects autoDiscoverSandboxes: false and explicit overrides for the same provider/id", async () => {
    const execTool = createTool({
      name: "exec_command",
      description: "Run command",
      inputSchema: z.object({}),
      handler: () => "ok",
    });

    attachSandboxMeta(execTool, {
      inspector: {
        id: "sb-2",
        provider: "docker",
        workdir: "/workspace",
        listFiles: async () => [],
        readFile: async () => new Uint8Array(),
      },
    });

    const agent = new Agent({
      id: "coder",
      model: createFakeModel(),
      tools: [execTool],
    });

    const disabledStudio = new Studio([agent], { autoDiscoverSandboxes: false });
    const emptyBody = (await (
      await disabledStudio.fetch(new Request("http://localhost/sandboxes"))
    ).json()) as { sandboxes: unknown[] };
    expect(emptyBody.sandboxes).toEqual([]);

    const overrideStudio = new Studio([agent], {
      sandboxes: [
        {
          inspector: {
            id: "sb-2",
            provider: "docker",
            workdir: "/custom",
            listFiles: async () => [],
            readFile: async () => new Uint8Array(),
          },
        },
      ],
    });
    const overrideBody = (await (
      await overrideStudio.fetch(new Request("http://localhost/sandboxes"))
    ).json()) as {
      sandboxes: { workdir: string; agentIds: string[]; toolNames: string[] }[];
    };
    expect(overrideBody.sandboxes).toHaveLength(1);
    expect(overrideBody.sandboxes[0]).toMatchObject({
      workdir: "/custom",
      agentIds: ["coder"],
      toolNames: ["exec_command"],
    });
  });
});
