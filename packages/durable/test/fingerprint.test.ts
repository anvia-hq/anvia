import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTool } from "@anvia/core/tool";
import { agentVersion, DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { Agent as CoreAgent } from "@anvia/core/agent";
import { Agent, capabilities, done } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close().catch(() => undefined);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

type Overrides = {
  instructions?: string;
  modelId?: string;
  maxTurns?: number;
  toolField?: string;
  approval?: boolean;
  providerOptions?: Record<string, unknown>;
  output?: z.ZodType;
  toolBody?: () => string;
  completion?: (signal?: AbortSignal) => Promise<ReturnType<typeof done>>;
};

function build(overrides: Overrides = {}) {
  const field = overrides.toolField ?? "q";
  const body = overrides.toolBody ?? (() => "ok");
  const toolOptions: Record<string, unknown> = {
    name: "lookup",
    description: "Look something up.",
    inputSchema: z.object({ [field]: z.string() }),
    execute: async () => body(),
  };

  if (overrides.approval === true) toolOptions.requiresApproval = true;

  const tool = createTool(toolOptions as never);
  const options: Record<string, unknown> = {
    id: "researcher",
    instructions: overrides.instructions ?? "Be brief.",
    tools: [tool],
    model: {
      provider: "test",
      modelId: overrides.modelId ?? "m1",
      capabilities,
      completion: (_request: unknown, call?: { abortSignal?: AbortSignal }) =>
        (overrides.completion ?? (async () => done()))(call?.abortSignal),
    },
  };

  if (overrides.maxTurns !== undefined) options.maxTurns = overrides.maxTurns;

  if (overrides.providerOptions !== undefined) options.providerOptions = overrides.providerOptions;

  if (overrides.output !== undefined) options.outputSchema = overrides.output;

  return new Agent(options as never) as unknown as CoreAgent<unknown>;
}

describe("agentVersion", () => {
  it("is stable for identical configuration built separately", async () => {
    expect(await agentVersion(build())).toBe(await agentVersion(build()));
    expect(await agentVersion(build())).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it.each([
    ["instructions", { instructions: "Be verbose." }],
    ["model", { modelId: "m2" }],
    ["turn limit", { maxTurns: 3 }],
    ["tool schema", { toolField: "query" }],
    ["tool approval flag", { approval: true }],
    ["provider options", { providerOptions: { effort: "high" } }],
    ["output schema", { output: z.object({ answer: z.string() }) }],
  ] as const)("changes when the %s changes", async (_name, override) => {
    expect(await agentVersion(build(override))).not.toBe(await agentVersion(build()));
  });

  it("does not see a tool implementation change (documented limit)", async () => {
    expect(await agentVersion(build({ toolBody: () => "different" }))).toBe(
      await agentVersion(build()),
    );
  });
});

describe('version: "auto"', () => {
  function database() {
    const directory = mkdtempSync(join(tmpdir(), "durable-auto-"));
    directories.push(directory);
    return join(directory, "runs.sqlite");
  }

  async function open(path: string, agent: CoreAgent<unknown>) {
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(path),
      agents: [
        {
          agent,
          version: "auto",
          modelRetry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
        },
      ],
    });
    runtimes.push(runtime);
    return runtime;
  }

  it("records the derived version and refuses a run after the agent drifted", async () => {
    const path = database();
    const hanging = build({
      completion: (signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        ),
    });
    const first = await open(path, hanging);
    const run = await first.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    expect((await run.snapshot()).run.version).toBe(await agentVersion(hanging));
    await first.close();

    const same = await open(path, build());
    await same.resume();
    expect(await (await same.getRun(run.id)).result()).toMatchObject({ output: "done" });
  });

  it("fails the run with a drift message when the configuration changed", async () => {
    const path = database();
    const first = await open(
      path,
      build({
        completion: (signal) =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason)),
          ),
      }),
    );
    const run = await first.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await first.close();

    const drifted = await open(path, build({ instructions: "Changed." }));
    await drifted.resume();
    await expect
      .poll(async () => (await drifted.status(run.id)).error ?? "", { timeout: 5000 })
      .toMatch(/declared configuration/);
    expect((await drifted.status(run.id)).status).toBe("needs_attention");
  });

  it("must be resolved in open(), not registerAgents()", async () => {
    const runtime = await open(database(), build());
    expect(() =>
      runtime.registerAgents([
        { agent: new Agent({ id: "other", model: build().model }), version: "auto" },
      ]),
    ).toThrow(/agentVersion/);
  });
});
