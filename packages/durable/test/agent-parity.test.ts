import { afterEach, expect, it } from "vitest";
import { Agent, createVectorContext } from "@anvia/core/agent";
import type { CompletionModelStreamEvent } from "@anvia/core/completion";
import { defineGuardrailPolicy } from "@anvia/core/guardrails";
import type { MemoryStore } from "@anvia/core/memory";
import type { ToolIndex } from "@anvia/core/tool";
import {
  DurableRuntime,
  type DurableAgentCompatibility,
  type DurableAgentRegistration,
} from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, lookup, makeAgent, makeStreamingAgent } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
async function open(options: Partial<Parameters<typeof DurableRuntime.open>[0]> = {}) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    ...options,
  });
  runtimes.push(runtime);
  return runtime;
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

const memoryStore: MemoryStore = {
  load: async () => [],
  append: async () => {},
  clear: async () => {},
};

const toolIndex: ToolIndex = {
  kind: "tool-index",
  tools: [],
  topK: 1,
  search: async () => [],
};

// Live retrieval is still rejected; static documents are supported and covered below.
const vectorContext = createVectorContext({
  model: { provider: "test", modelId: "embedding", embedTexts: async () => [] },
  store: {
    async ensure() {},
    async validate() {},
    async upsert() {},
    async search() {
      return [];
    },
  },
  topK: 1,
});

const model = makeAgent(async () => done()).model;
const agentWith = (
  id: string,
  options: Record<string, unknown> = {},
): DurableAgentRegistration["agent"] =>
  new Agent({ id, model, ...options } as ConstructorParameters<typeof Agent>[0]);

async function* emptyStream(): AsyncIterable<CompletionModelStreamEvent> {}

/** Extracts the feature list from the combined registration rejection. */
function rejectedFeatures(registration: DurableAgentRegistration): string[] {
  const runtime = runtimes.at(-1)!;
  try {
    runtime.registerAgents([registration]);
  } catch (error) {
    const message = (error as Error).message;
    expect(message).toContain(`"${registration.agent.id}"`);
    expect(message).toContain("checkpoint support");
    expect(message).toContain("static local tools");
    const list = message.split("checkpoint support: ")[1]?.split(".")[0];
    expect(list).toBeDefined();
    return list!.split(", ");
  }
  throw new Error(`Expected ${registration.agent.id} to be rejected`);
}

it.each([
  ["memory", () => agentWith("with-memory", { memory: { store: memoryStore } })],
  ["lifecycle", () => agentWith("with-lifecycle", { lifecycle: { onStart: () => {} } })],
  ["middleware", () => agentWith("with-middleware", { middlewares: [{}] })],
  [
    "guardrails",
    () => agentWith("with-guardrails", { guardrails: defineGuardrailPolicy({ id: "policy" }) }),
  ],
  ["context", () => agentWith("with-context", { context: [vectorContext] })],
  ["MCP servers", () => agentWith("with-mcp", { mcpServers: [{ name: "server", tools: [] }] })],
  [
    "provider tools",
    () =>
      agentWith("with-provider-tools", {
        tools: [{ kind: "provider", provider: "openai", name: "web_search" }],
      }),
  ],
  ["tool indexes", () => agentWith("with-tool-index", { tools: [toolIndex] })],
])("names only the rejected feature group: %s", async (feature, makeRejected) => {
  const runtime = await open();
  expect(runtime.compatibility()).toEqual([]);
  expect(rejectedFeatures({ agent: makeRejected(), version: "1" })).toEqual([feature]);
  expect(runtime.compatibility()).toEqual([]);
});

it("lists every feature the agent actually sets, in a stable order", async () => {
  await open();
  const agent = agentWith("with-several", {
    memory: { store: memoryStore },
    guardrails: defineGuardrailPolicy({ id: "policy" }),
    context: [vectorContext],
  });
  expect(rejectedFeatures({ agent, version: "1" })).toEqual(["memory", "guardrails", "context"]);
});

it("rejects an agent-level retries setting and points at modelRetry", async () => {
  const runtime = await open();
  expect(() =>
    runtime.registerAgents([
      { agent: agentWith("retrying", { retries: { maxAttempts: 3 } }), version: "1" },
    ]),
  ).toThrow(/"retrying" defines retries/);
  expect(() =>
    runtime.registerAgents([
      { agent: agentWith("retrying", { retries: { maxAttempts: 3 } }), version: "1" },
    ]),
  ).toThrow(/modelRetry/);
  expect(runtime.compatibility()).toEqual([]);
});

it.each([[false], [{ maxAttempts: 1 }], [{ maxAttempts: 0 }]])(
  "accepts retries that would not retry anyway: %o",
  async (retries) => {
    const runtime = await open();
    runtime.registerAgents([{ agent: agentWith("retrying", { retries }), version: "1" }]);
    expect(runtime.compatibility().map((entry) => entry.agentId)).toEqual(["retrying"]);
  },
);

it("keeps static tools, skills, streaming, compaction, and modelRetry accepted", async () => {
  const runtime = await open();
  runtime.registerAgents([
    {
      agent: new Agent({
        id: "tooled",
        model,
        instructions: "Answer.",
        tools: [lookup(async () => "result")],
        skills: {
          skills: [],
          tools: [{ ...lookup(async () => "skill result"), name: "skill-tool" }],
          instructions: "Skill instructions.",
        },
      }),
      version: "1",
      modelRetry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 100 },
    },
    {
      agent: makeStreamingAgent(emptyStream),
      version: "2",
      stream: true,
    },
    {
      agent: agentWith("compacting"),
      version: "3",
      compaction: {
        trigger: { afterTokens: 100 },
        compactor: async () => ({ summary: "summary" }),
      },
    },
  ]);
  const [tooled, streaming, compacting] = runtime.compatibility();
  expect(tooled).toMatchObject({
    agentId: "tooled",
    version: "1",
    tools: ["lookup", "skill-tool"],
    streaming: false,
    compaction: false,
    modelRetry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 100 },
  });
  expect(streaming).toMatchObject({ agentId: "researcher", streaming: true, compaction: false });
  expect(compacting).toMatchObject({ agentId: "compacting", version: "3", compaction: true });
});

it("reports frozen and unavailable settings without changing the registrations", async () => {
  const runtime = await open();
  runtime.registerAgents([
    {
      agent: agentWith("configured", {
        maxTurns: 3,
        temperature: 0.2,
        controls: {},
        toolChoice: "auto",
      }),
      version: "1",
    },
  ]);
  const [report] = runtime.compatibility();
  expect(report).toMatchObject({
    agentId: "configured",
    version: "1",
    frozen: ["maxTurns", "controls", "toolChoice", "temperature"],
  });
  expect(report?.unavailable).toEqual([
    "retries",
    "maxTurns",
    "controls",
    "lifecycle",
    "guardrails",
    "middlewares",
    "toolConcurrency",
    "session",
  ]);
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.isFrozen(report?.frozen)).toBe(true);
  expect(Object.isFrozen(report?.unavailable)).toBe(true);
  // A detached report cannot be used to alter what the runtime will execute.
  expect(() => {
    (report as unknown as { tools: string[] }).tools = ["injected"];
  }).toThrow(TypeError);
  expect(runtime.compatibility()[0]?.tools).toEqual([]);
});

it("calls onCompatibility on open and after each registerAgents with a detached copy", async () => {
  const reports: Array<readonly DurableAgentCompatibility[]> = [];
  const runtime = await open({
    agents: [{ agent: agentWith("first"), version: "1" }],
    onCompatibility: (report) => {
      reports.push(report);
    },
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.map((entry) => entry.agentId)).toEqual(["first"]);

  runtime.registerAgents([{ agent: agentWith("second"), version: "2" }]);
  expect(reports).toHaveLength(2);
  expect(reports[1]?.map((entry) => entry.agentId)).toEqual(["first", "second"]);
  // The earlier report is a snapshot, not a live view of the registration map.
  expect(reports[0]).toHaveLength(1);
  expect(reports[1]).not.toBe(reports[0]);

  const current = runtime.compatibility();
  expect(current).not.toBe(reports[1]);
  expect(current.map((entry) => entry.agentId)).toEqual(["first", "second"]);
  expect(() => runtime.registerAgents([{ agent: agentWith("first"), version: "9" }])).toThrow(
    "already registered",
  );
  expect(reports).toHaveLength(2);
});

it("ignores a throwing onCompatibility callback and keeps the runtime usable", async () => {
  const runtime = await open({
    agents: [{ agent: agentWith("first"), version: "1" }],
    onCompatibility: () => {
      throw new Error("logger failed");
    },
  });
  expect(runtime.compatibility().map((entry) => entry.agentId)).toEqual(["first"]);
});

it("ignores a rejecting onCompatibility callback on open and registerAgents", async () => {
  let calls = 0;
  const runtime = await open({
    agents: [{ agent: agentWith("first"), version: "1" }],
    onCompatibility: async () => {
      calls += 1;
      throw new Error("logger failed");
    },
  });
  runtime.registerAgents([{ agent: agentWith("second"), version: "2" }]);
  await Promise.resolve();
  expect(calls).toBe(2);
  expect(runtime.compatibility().map((entry) => entry.agentId)).toEqual(["first", "second"]);
});

it("keeps a registration when onCompatibility throws during registerAgents", async () => {
  let fail = false;
  const runtime = await open({
    agents: [{ agent: agentWith("first"), version: "1" }],
    onCompatibility: () => {
      if (fail) throw new Error("logger failed");
    },
  });
  fail = true;
  expect(() =>
    runtime.registerAgents([{ agent: agentWith("second"), version: "2" }]),
  ).not.toThrow();
  expect(runtime.compatibility().map((entry) => entry.agentId)).toEqual(["first", "second"]);
});
