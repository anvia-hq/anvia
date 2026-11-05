import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { AgentMiddleware } from "@anvia/core/tool";
import type { CompletionRequest } from "@anvia/core/completion";
import { defineGuardrailPolicy, type GuardrailPolicyOptions } from "@anvia/core/guardrails";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, hasToolResult, lookup, toolResponse } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-middleware-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

function agentWith(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  options: { middlewares?: AgentMiddleware[]; guardrails?: GuardrailPolicyOptions } = {},
  tools: ReturnType<typeof lookup>[] = [],
): Agent<unknown> {
  const definition: ConstructorParameters<typeof Agent>[0] = {
    id: "transforming",
    tools,
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
  };
  if (options.middlewares !== undefined) definition.middlewares = options.middlewares;
  if (options.guardrails !== undefined)
    definition.guardrails = defineGuardrailPolicy(options.guardrails);
  return new Agent<unknown>(definition);
}

async function open(
  path: string,
  agent: Agent<unknown>,
  options: Partial<DurableAgentRegistration> = {},
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", ...options }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

/** Rewrites one operation record in place, as a crash would have left it. */
function leaveStarted(path: string, runId: string, keyPart: string) {
  const db = new DatabaseSync(path);
  const rows = db
    .prepare("SELECT key, record FROM anvia_durable_operations WHERE run_id = ?")
    .all(runId) as Array<{ key: string; record: string }>;
  const row = rows.find((candidate) => candidate.key.includes(keyPart))!;
  const record = JSON.parse(row.record) as Record<string, unknown>;
  db.prepare("UPDATE anvia_durable_operations SET record = ? WHERE run_id = ? AND key = ?").run(
    JSON.stringify({ ...record, status: "started", result: undefined }),
    runId,
    row.key,
  );
  db.close();
  return row.key;
}

const submission = { agentId: "transforming", sessionId: "session", requestId: "one" };
const pure = { middlewares: { mode: "pure" as const } };
const recorded = { guardrails: { mode: "record" as const } };

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("registration of middleware and recorded guardrails", () => {
  it.each([
    ["middlewares with the pure marker", { middlewares: [{}] }, pure],
    ["guardrails with the record marker", { guardrails: { id: "policy" } }, recorded],
  ])("accepts %s", async (_name, options, registration) => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent: agentWith(async () => done(), options), version: "1", ...registration }],
      }),
    ).resolves.toBeDefined();
  });

  it("rejects middleware without the pure marker and names the marker", async () => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent: agentWith(async () => done(), { middlewares: [{}] }), version: "1" }],
      }),
    ).rejects.toThrow(/middleware needs \{ middlewares: \{ mode: "pure" \} \}/);
  });

  it("rejects guardrails without the record marker and names the marker", async () => {
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [
          {
            agent: agentWith(async () => done(), { guardrails: { id: "policy" } }),
            version: "1",
          },
        ],
      }),
    ).rejects.toThrow(/guardrails need \{ guardrails: \{ mode: "record" \} \}/);
  });

  it("rejects an unknown middlewares or guardrails mode", async () => {
    const agent = agentWith(async () => done(), { middlewares: [{}] });
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [{ agent, version: "1", middlewares: { mode: "effectful" } as never }],
      }),
    ).rejects.toThrow(/unknown middlewares mode/);
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(":memory:"),
        agents: [
          {
            agent: agentWith(async () => done(), { guardrails: { id: "policy" } }),
            version: "1",
            guardrails: { mode: "observe" } as never,
          },
        ],
      }),
    ).rejects.toThrow(/unknown guardrails mode/);
  });
});

describe("pure middleware", () => {
  it("replays a failed model turn with the persisted transformed request", async () => {
    const transform: AgentMiddleware = {
      onCompletionRequest: ({ request }) => ({ request: { ...request, temperature: 0.2 } }),
    };
    const tool = vi.fn(async () => "found");
    const path = database();
    const first = vi.fn(async (request: CompletionRequest) => {
      if (!hasToolResult(request)) return toolResponse();
      throw new Error("provider down");
    });
    const runtime = await open(
      path,
      agentWith(first, { middlewares: [transform] }, [lookup(tool)]),
      pure,
    );
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(first.mock.calls[0]![0].temperature).toBe(0.2);
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(
      path,
      agentWith(second, { middlewares: [transform] }, [lookup(tool)]),
      pure,
    );
    await (await reopened.getRun(submitted.id)).retry();
    expect((await settled(await reopened.getRun(submitted.id))).run.status).toBe("completed");

    // The tool result was restored from the journal, not executed again.
    expect(tool).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toMatchObject({ temperature: 0.2 });
    expect(hasToolResult(second.mock.calls[0]![0])).toBe(true);
  });

  it("fails a changed transformation under the same operation key with a recovery error", async () => {
    const path = database();
    const first = vi.fn(async (request: CompletionRequest) => {
      if (!hasToolResult(request)) return toolResponse();
      throw new Error("provider down");
    });
    const tool = vi.fn(async () => "found");
    const runtime = await open(
      path,
      agentWith(
        first,
        {
          middlewares: [
            {
              onCompletionRequest: ({ request }) => ({ request: { ...request, temperature: 0.2 } }),
            },
          ],
        },
        [lookup(tool)],
      ),
      pure,
    );
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(
      path,
      agentWith(
        second,
        {
          middlewares: [
            {
              onCompletionRequest: ({ request }) => ({ request: { ...request, temperature: 0.9 } }),
            },
          ],
        },
        [lookup(tool)],
      ),
      pure,
    );
    await (await reopened.getRun(submitted.id)).retry();
    const snapshot = await settled(await reopened.getRun(submitted.id));
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.run.error).toContain("Execution changed at a saved checkpoint");
    expect(second).not.toHaveBeenCalled();
  });

  it("persists the transformed tool input and does not execute the tool again on retry", async () => {
    const transform: AgentMiddleware = {
      onToolInput: ({ args }) => ({ args: JSON.stringify({ ...JSON.parse(args), tagged: true }) }),
    };
    const tool = vi.fn(async (_args: unknown) => "found");
    const path = database();
    const first = vi.fn(async (request: CompletionRequest) => {
      if (!hasToolResult(request)) return toolResponse();
      throw new Error("provider down");
    });
    const runtime = await open(
      path,
      agentWith(first, { middlewares: [transform] }, [lookup(tool)]),
      pure,
    );
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(tool.mock.calls[0]![0]).toMatchObject({ tagged: true });
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(
      path,
      agentWith(second, { middlewares: [transform] }, [lookup(tool)]),
      pure,
    );
    await (await reopened.getRun(submitted.id)).retry();
    expect((await settled(await reopened.getRun(submitted.id))).run.status).toBe("completed");
    expect(tool).toHaveBeenCalledTimes(1);
  });
});

describe("recorded guardrails", () => {
  it("makes a blocking input decision terminal across a restart", async () => {
    const check = vi.fn((_context: unknown, actions: { block(o: object): unknown }) =>
      actions.block({ reason: "pii", message: "Not allowed." }),
    );
    const path = database();
    const first = vi.fn(async (_request: CompletionRequest) => done());
    const agent = agentWith(first, {
      guardrails: { id: "policy", input: [{ id: "pii", check: check as never }] },
    });
    const runtime = await open(path, agent, recorded);
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    const outcome = (await submitted.result()) as unknown as { type: string; text: string };
    expect(outcome).toMatchObject({ type: "blocked", text: "Not allowed." });
    expect(first).not.toHaveBeenCalled();
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(
      path,
      agentWith(second, {
        guardrails: { id: "policy", input: [{ id: "pii", check: check as never }] },
      }),
      recorded,
    );
    const replayed = (await (await reopened.getRun(submitted.id)).result()) as unknown as {
      type: string;
    };
    expect(replayed.type).toBe("blocked");
    expect(second).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reuses recorded input and output decisions when a failed run is retried", async () => {
    const inputCheck = vi.fn(async () => undefined);
    const outputCheck = vi.fn((_context: unknown, actions: { rewrite(o: object): unknown }) =>
      actions.rewrite({ outputText: "redacted" }),
    );
    const guardrails = {
      id: "policy",
      input: [{ id: "scan", check: inputCheck as never }],
      output: [{ id: "redact", check: outputCheck as never }],
    };
    const path = database();
    const first = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const runtime = await open(path, agentWith(first, { guardrails }), recorded);
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(inputCheck).toHaveBeenCalledTimes(1);
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(path, agentWith(second, { guardrails }), recorded);
    await (await reopened.getRun(submitted.id)).retry();
    const snapshot = await settled(await reopened.getRun(submitted.id));
    expect(snapshot.run.status).toBe("completed");
    // The input check was recorded before the first failure, so the retry reuses it.
    expect(inputCheck).toHaveBeenCalledTimes(1);
    expect(outputCheck).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(snapshot.run.outcome ?? snapshot)).toContain("redacted");
  });

  it("runs an input check again after it failed with an error and the run is retried", async () => {
    let fail = true;
    const check = vi.fn(async () => {
      if (fail) throw new Error("moderation timeout");
      return undefined;
    });
    const path = database();
    const first = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(
      path,
      agentWith(first, {
        guardrails: { id: "policy", input: [{ id: "scan", check: check as never }] },
      }),
      recorded,
    );
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(check).toHaveBeenCalledTimes(1);
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    // The moderation service recovers. The retry runs the check once more, and the run completes.
    fail = false;
    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(
      path,
      agentWith(second, {
        guardrails: { id: "policy", input: [{ id: "scan", check: check as never }] },
      }),
      recorded,
    );
    await (await reopened.getRun(submitted.id)).retry();
    expect((await settled(await reopened.getRun(submitted.id))).run.status).toBe("completed");
    expect(check).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("rejects two checks with the same id in one policy at registration", async () => {
    const path = database();
    const duplicate = agentWith(async () => done(), {
      guardrails: {
        id: "policy",
        input: [
          { id: "scan", check: (() => undefined) as never },
          { id: "scan", check: (() => undefined) as never },
        ],
      },
    });
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(path),
        agents: [{ agent: duplicate, version: "1", guardrails: recorded.guardrails }],
      }),
    ).rejects.toThrow(/two input guardrails named "scan"/);
  });

  it("blocks the run for reconciliation when a check stopped before its outcome was recorded", async () => {
    const path = database();
    const check = vi.fn(async () => undefined);
    const guardrails = { id: "policy", input: [{ id: "scan", check: check as never }] };
    const first = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const runtime = await open(path, agentWith(first, { guardrails }), recorded);
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    leaveStarted(path, submitted.id, ":guardrail:input:0:policy:scan");

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(path, agentWith(second, { guardrails }), recorded);
    await (await reopened.getRun(submitted.id)).retry();
    const snapshot = await settled(await reopened.getRun(submitted.id));
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.run.error).toContain("was interrupted before its outcome was recorded");
    expect(second).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("records an interrupted observe-mode check as an error and lets the run continue", async () => {
    const path = database();
    const check = vi.fn(async () => undefined);
    const guardrails = {
      id: "policy",
      mode: "observe" as const,
      input: [{ id: "scan", check: check as never }],
    };
    const first = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const runtime = await open(path, agentWith(first, { guardrails }), recorded);
    const submitted = await runtime.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    leaveStarted(path, submitted.id, ":guardrail:input:0:policy:scan");

    const second = vi.fn(async (_request: CompletionRequest) => done());
    const reopened = await open(path, agentWith(second, { guardrails }), recorded);
    await (await reopened.getRun(submitted.id)).retry();
    expect((await settled(await reopened.getRun(submitted.id))).run.status).toBe("completed");
    expect(second).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
