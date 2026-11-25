import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import { Usage, type CompletionRequest, type Message } from "@anvia/core/completion";
import type { MemoryCompactor } from "@anvia/core/memory";
import { DurableRuntime } from "../src/index.js";
import { createRunRecord } from "../src/run-record.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableAgentRegistration, DurableOperation, DurableRunRecord } from "../src/types.js";
import { done, lookup, makeAgent, toolResponse } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "request",
  prompt: "hello",
};

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "anvia-durable-settled-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(
  path: string,
  agent = makeAgent(async () => done()),
  options: Pick<DurableAgentRegistration, "compaction"> = {},
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", ...options }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function record(
  overrides: Partial<DurableRunRecord> & { requestId: string },
): Promise<DurableRunRecord> {
  const agent = makeAgent(async () => done());
  const base = await createRunRecord(
    { ...submission, requestId: overrides.requestId },
    { agent, version: "1" },
  );
  return { ...base, ...overrides };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("latestCompleted", () => {
  async function latestCompleted(
    records: DurableRunRecord[],
  ): Promise<DurableRunRecord | undefined> {
    const store = new SqliteDurableStore(":memory:");
    await store.acquire();
    try {
      await store.transaction(async (tx) => {
        for (const run of records) await tx.putRun(run);
      });
      return store.transaction(async (tx) => tx.latestCompleted("session"));
    } finally {
      await store.close();
    }
  }

  it("picks a started failed run over an earlier completed run", async () => {
    const latest = await latestCompleted([
      await record({
        requestId: "one",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        outcome: {
          runId: "one",
          type: "response",
          text: "done",
          output: "done",
          usage: Usage.empty(),
          messages: [],
        },
      }),
      await record({ requestId: "two", status: "failed", startedAt: "2026-01-01T00:00:01.000Z" }),
    ]);
    expect(latest?.requestId).toBe("two");
  });

  it("picks a started cancelled run over an earlier completed run", async () => {
    const latest = await latestCompleted([
      await record({
        requestId: "one",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        outcome: {
          runId: "one",
          type: "response",
          text: "done",
          output: "done",
          usage: Usage.empty(),
          messages: [],
        },
      }),
      await record({
        requestId: "two",
        status: "cancelled",
        startedAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    expect(latest?.requestId).toBe("two");
  });

  it("skips failed and cancelled runs that never started", async () => {
    const latest = await latestCompleted([
      await record({
        requestId: "one",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        outcome: {
          runId: "one",
          type: "response",
          text: "done",
          output: "done",
          usage: Usage.empty(),
          messages: [],
        },
      }),
      await record({ requestId: "two", status: "failed" }),
      await record({ requestId: "three", status: "cancelled" }),
    ]);
    expect(latest?.requestId).toBe("one");
  });

  it("returns undefined when only unstarted runs exist", async () => {
    expect(
      await latestCompleted([await record({ requestId: "one", status: "failed" })]),
    ).toBeUndefined();
  });
});

describe("settled session history", () => {
  it.each([false, true])(
    "keeps approved tool results after a resumed model failure (compaction: %s)",
    async (compact) => {
      const requests: CompletionRequest[] = [];
      const tool = vi.fn(async () => "approved result");
      const compactor = vi.fn<MemoryCompactor>(async () => ({ summary: "Earlier conversation." }));
      const hasApprovedResult = (messages: readonly Message[]) =>
        messages.some(
          (message) =>
            message.role === "tool" &&
            message.content.some(
              (part) => part.type === "tool-result" && part.toolCallId === "call-1",
            ),
        );
      const agent = makeAgent(
        async (request) => {
          requests.push(request);

          if (requests.length === 2) return toolResponse();

          if (requests.length === 3) throw new Error("provider unavailable");

          return done();
        },
        [{ ...lookup(tool), requiresApproval: true }],
      );
      const options: Pick<DurableAgentRegistration, "compaction"> = compact
        ? {
            compaction: {
              trigger: { afterTokens: 1 },
              retention: { recentTurns: 0 },
              compactor,
            },
          }
        : {};
      const path = database();
      const runtime = await open(path, agent, options);
      await (
        await runtime.submit({ ...submission, requestId: "earlier", prompt: "earlier" })
      ).result();
      const run = await runtime.submit(submission);
      await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
      const outcome = (await run.snapshot()).run.outcome;

      if (outcome?.type !== "interaction") throw new Error("Expected approval");

      await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
      await expect(run.result()).rejects.toMatchObject({ status: "failed" });
      await runtime.close();

      const recovered = await open(path, agent, options);
      const next = await recovered.submit({ ...submission, requestId: "next", prompt: "continue" });
      await next.result();
      const history = (await next.snapshot()).run.history;
      expect(
        history.filter((message) => message.role === "user").map((message) => message.content),
      ).toEqual(["earlier", "hello"]);
      expect(history.filter((message) => message.role === "assistant")).toHaveLength(2);
      expect(
        history
          .filter((message) => message.role === "tool")
          .flatMap((message) => message.content)
          .filter((part) => part.type === "tool-result"),
      ).toEqual([
        expect.objectContaining({
          toolCallId: "call-1",
          output: { type: "text", value: "approved result" },
        }),
      ]);

      if (compact) {
        expect(hasApprovedResult(compactor.mock.calls.at(-1)![0].messages)).toBe(true);
      } else {
        expect(hasApprovedResult(requests.at(-1)!.chatHistory)).toBe(true);
      }

      expect(tool).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the resolved approval exchange after exhausting the turn budget", async () => {
    const tool = vi.fn(async () => "approved result");
    const base = makeAgent(
      async () => toolResponse(),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const agent = new Agent({ id: base.id, model: base.model, tools: base.tools, maxTurns: 0 });
    const runtime = await open(database(), agent);
    const run = await runtime.submit(submission);
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
    const outcome = (await run.snapshot()).run.outcome;

    if (outcome?.type !== "interaction") throw new Error("Expected approval");

    await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
    await expect(run.result()).rejects.toMatchObject({ status: "failed" });
    expect((await run.snapshot()).run.exhaustion?.reason).toBe("max_turns");
    const next = await runtime.submit({ ...submission, requestId: "next", prompt: "continue" });
    await vi.waitFor(async () => expect((await next.snapshot()).run.status).toBe("waiting"));
    const history = (await next.snapshot()).run.history;
    expect(history.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(
      history
        .filter((message) => message.role === "tool")
        .flatMap((message) => message.content)
        .filter((part) => part.type === "tool-result"),
    ).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        output: { type: "text", value: "approved result" },
      }),
    ]);
    expect(tool).toHaveBeenCalledTimes(1);
  });

  it("does not carry unresolved approval calls from a cancelled run into the next prompt", async () => {
    let calls = 0;
    const tool = vi.fn(async () => "not executed");
    const agent = makeAgent(
      async () => (++calls === 1 ? toolResponse() : done()),
      [{ ...lookup(tool), requiresApproval: true }],
    );
    const path = database();
    const runtime = await open(path, agent);
    const run = await runtime.submit(submission);
    await vi.waitFor(async () => expect((await run.snapshot()).run.status).toBe("waiting"));
    const outcome = (await run.snapshot()).run.outcome;

    if (outcome?.type !== "interaction") throw new Error("Expected approval");

    await runtime.respond(run.id, outcome.interaction.id, {
      type: "tool-approval",
      approved: true,
    });
    await runtime.cancel(run.id);
    await runtime.close();
    const recovered = await open(path, agent);
    const next = await recovered.submit({ ...submission, requestId: "next", prompt: "continue" });
    await next.result();
    expect((await next.snapshot()).run.history).toEqual([{ role: "user", content: "hello" }]);
    expect(tool).not.toHaveBeenCalled();
  });

  it("continues a failed run's progress in the next submission", async () => {
    const tool = vi.fn(async () => "partial work");
    const base = makeAgent(async () => toolResponse(), [lookup(tool)]);
    const agent = new Agent({ id: base.id, model: base.model, tools: base.tools, maxTurns: 0 });
    const runtime = await open(database(), agent);

    const failed = await runtime.submit(submission);
    await expect(failed.result()).rejects.toMatchObject({ status: "failed" });
    expect((await failed.snapshot()).run.exhaustion?.reason).toBe("max_turns");

    const next = await runtime.submit({ ...submission, requestId: "next", prompt: "continue" });
    await expect(next.result()).rejects.toMatchObject({ status: "failed" });
    const history = (await next.snapshot()).run.history;
    expect(history).toHaveLength(3);
    expect(history.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(history.some((message) => message.role === "tool")).toBe(true);
  });

  it("recovers the latest context checkpoint of a cancelled run", async () => {
    const path = database();
    const store = new SqliteDurableStore(path);
    await store.acquire();
    const agent = makeAgent(async () => done());
    const registration = { agent, version: "1" };
    const user = { role: "user", content: "hello" } as const;
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
    } as const;
    const cancelled = {
      ...(await createRunRecord({ ...submission, requestId: "cancelled" }, registration)),
      status: "cancelled" as const,
      startedAt: "2026-01-01T00:00:01.000Z",
      epoch: 2,
      error: "Durable run cancelled.",
    };
    const context = (key: string, input: DurableOperation["input"]) => ({
      key,
      kind: "context" as const,
      status: "started" as const,
      recovery: "safe" as const,
      input,
    });
    await store.transaction(async (tx) => {
      await tx.putRun(cancelled);
      await tx.putRun({ ...cancelled });
      await tx.putOperation(cancelled.id, context("2:context:1", [user]));
      await tx.putOperation(cancelled.id, context("2:context:3", [user, assistant]));
    });
    await store.close();

    const runtime = await open(path);
    const next = await runtime.submit({ ...submission, requestId: "next", prompt: "continue" });
    const completed = await next.result();
    expect(completed).toMatchObject({ type: "response", output: "done" });
    const history = (await next.snapshot()).run.history;
    expect(history).toEqual([user, assistant]);
  });

  it("ignores an exhaustion tail with no assistant message and bare failed runs", async () => {
    const user = { role: "user", content: "hello" } as const;
    const exhaustionOnlyUserPath = database();
    const store1 = new SqliteDurableStore(exhaustionOnlyUserPath);
    await store1.acquire();
    const agent = makeAgent(async () => done());
    const failedWithUserTail = {
      ...(await createRunRecord(
        { ...submission, requestId: "failed-tail" },
        { agent, version: "1" },
      )),
      status: "failed" as const,
      startedAt: "2026-01-01T00:00:01.000Z",
      exhaustion: {
        reason: "max_turns" as const,
        messages: [user, { role: "user" as const, content: "again" }],
      },
    };
    const bareFailed = {
      ...(await createRunRecord(
        { ...submission, requestId: "bare-failed" },
        { agent, version: "1" },
      )),
      status: "failed" as const,
      startedAt: "2026-01-01T00:00:01.000Z",
    };
    await store1.transaction(async (tx) => {
      await tx.putRun(failedWithUserTail);
    });
    await store1.close();

    const runtime1 = await open(exhaustionOnlyUserPath);
    const next1 = await runtime1.submit({ ...submission, requestId: "next-1", prompt: "continue" });
    await expect(next1.result()).resolves.toMatchObject({ type: "response", output: "done" });
    expect((await next1.snapshot()).run.history).toEqual([]);

    const barePath = database();
    const store2 = new SqliteDurableStore(barePath);
    await store2.acquire();
    await store2.transaction(async (tx) => {
      await tx.putRun(bareFailed);
    });
    await store2.close();

    const runtime2 = await open(barePath);
    const next2 = await runtime2.submit({ ...submission, requestId: "next-2", prompt: "continue" });
    await expect(next2.result()).resolves.toMatchObject({ type: "response", output: "done" });
    expect((await next2.snapshot()).run.history).toEqual([]);
  });
});
