import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { createQuestionTool } from "@anvia/core/tool";
import { expectJournalRequests } from "./journal-assertions.js";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime, defineTask } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done, lookup, response, makeAgent } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

it.each([false, true])(
  "stores 75 tool rounds linearly (compaction: %s), preserving request bytes",
  async (compact) => {
    const directory = mkdtempSync(join(tmpdir(), "anvia-journal-"));
    directories.push(directory);
    const path = join(directory, "journal.sqlite");
    const requests: string[] = [];
    let calls = 0;
    const agent = new Agent({
      id: "researcher",
      maxTurns: 100,
      tools: [lookup(async () => `${calls}:` + "x".repeat(10_000))],
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        async completion(request) {
          requests.push(JSON.stringify(request));
          if (++calls > 75) return done();
          return response([
            { type: "tool-call", toolCallId: `call-${calls}`, toolName: "lookup", input: {} },
          ]);
        },
      },
    });
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(path),
      limits: { maxPayloadBytes: 64 * 1024 * 1024 },
      agents: [
        {
          agent,
          version: "1",
          ...(compact
            ? {
                compaction: {
                  trigger: { afterTokens: 20_000 },
                  retention: { recentToolTurns: 1 },
                  compactor: async () => ({ summary: `summary-${calls}`, usage: done().usage }),
                },
              }
            : {}),
        },
      ],
    });
    runtimes.push(runtime);
    const handle = await runtime.submit({
      agentId: agent.id,
      sessionId: "session",
      requestId: "one",
      prompt: "Research",
    });
    await handle.result();
    const operations = runtime.snapshot(handle.id).operations.filter((op) => op.kind === "model");
    expect(operations).toHaveLength(76);
    operations.forEach((operation, index) => {
      expect(operation.historyEncoding).toBe("linked-v1");
      expect(JSON.stringify(runtime.operationRequest(handle.id, operation.key))).toBe(
        requests[index],
      );
    });
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const bytes = (table: string, expression = "length(CAST(record AS BLOB))") =>
        Number(db.prepare(`SELECT coalesce(sum(${expression}), 0) AS n FROM ${table}`).get()!.n);
      const stored =
        bytes("anvia_durable_operations") +
        bytes("anvia_durable_messages") +
        bytes(
          "anvia_durable_histories",
          "length(hash) + coalesce(length(previous), 0) + length(message)",
        );
      const unique = bytes("anvia_durable_messages");
      expect(stored).toBeLessThan(unique * 3);
      // Events retain tool results and the final transcript, but must not repeat model histories.
      expect(bytes("anvia_durable_events", "length(CAST(data AS BLOB))")).toBeLessThan(unique * 3);
      expectJournalRequests(runtime, handle.id);
      if (!compact) expect(requests.join("").length).toBeGreaterThan(unique * 30);
    } finally {
      db.close();
    }
  },
  30_000,
);

it("status, run, list, scope, task snapshots and graphs never read operation payloads", async () => {
  const store = new SqliteDurableStore(":memory:");
  const task = defineTask({
    name: "empty",
    version: 1,
    input: z.null(),
    checkpoint: z.null(),
    output: z.null(),
    initial: () => null,
    run: async () => ({ status: "completed", output: null }),
  });
  const runtime = await DurableRuntime.open({
    store,
    tasks: [task],
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  runtimes.push(runtime);
  const handle = await runtime.submitTask(task, {
    sessionId: "task",
    requestId: "one",
    input: null,
  });
  await handle.result();
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "run",
    requestId: "one",
    prompt: "hello",
  });
  await run.result();
  const transaction = store.transaction.bind(store);
  let runReads = 0;
  const read = vi.fn(() => {
    throw new Error("Operation payload read");
  });
  vi.spyOn(store, "transaction").mockImplementation((callback) =>
    transaction((tx) =>
      callback({
        ...tx,
        operations: read,
        getOperation: read,
        getRun(id) {
          runReads++;
          return tx.getRun(id);
        },
      }),
    ),
  );
  expect(runtime.status(run.id).status).toBe("completed");
  expect(runReads).toBe(0);
  expect(runtime.run(run.id).status).toBe("completed");
  expect(runtime.runScope(run.id).sessionId).toBe("run");
  expect(runtime.snapshot(run.id, { operations: false }).operations).toEqual([]);
  await runtime.getRun(run.id);
  await handle.snapshot();
  await (await runtime.getTask(handle.id)).snapshot();
  await runtime.taskGraph(handle.id);
  await runtime.listRuns();
  expect(read).not.toHaveBeenCalled();
});

it("resumes an unfinished journal actually written by 0.6.0, preserving embedded requests", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/journal-0.6.0.json", import.meta.url), "utf8"),
  );
  const directory = mkdtempSync(join(tmpdir(), "anvia-legacy-journal-"));
  directories.push(directory);
  const path = join(directory, "journal.sqlite");
  // Restore the old on-disk tables verbatim, with neither a message log nor summaries.
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE anvia_durable_owner(singleton INTEGER PRIMARY KEY, version INTEGER, token TEXT, pid INTEGER, host TEXT);
    INSERT INTO anvia_durable_owner VALUES (1, 7, NULL, NULL, NULL);
    CREATE TABLE anvia_durable_runs(id TEXT PRIMARY KEY, session_id TEXT, request_id TEXT, status TEXT, record TEXT, UNIQUE(session_id, request_id));
    CREATE TABLE anvia_durable_operations(run_id TEXT, key TEXT, record TEXT, PRIMARY KEY(run_id, key));
    CREATE TABLE anvia_durable_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, created_at TEXT, type TEXT, data TEXT);
  `);
  for (const row of fixture.runs)
    db.prepare("INSERT INTO anvia_durable_runs VALUES (?, ?, ?, ?, ?)").run(
      row.id,
      row.session_id,
      row.request_id,
      row.status,
      row.record,
    );
  for (const row of fixture.operations)
    db.prepare("INSERT INTO anvia_durable_operations VALUES (?, ?, ?)").run(
      row.run_id,
      row.key,
      row.record,
    );
  for (const row of fixture.events)
    db.prepare("INSERT INTO anvia_durable_events VALUES (?, ?, ?, ?, ?)").run(
      row.sequence,
      row.run_id,
      row.created_at,
      row.type,
      row.data,
    );
  db.close();
  const model = vi.fn(async (request: CompletionRequest) => {
    expect(JSON.stringify(request)).toBe(fixture.requests[1]);
    return done();
  });
  const tool = vi.fn(async () => "must not run");
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent: makeAgent(model, [lookup(tool)]), version: "1" }],
  });
  runtimes.push(runtime);
  const id = fixture.runs[0].id;
  expect(runtime.status(id).status).toBe("running");
  expect(() => runtime.steer(id, { prompt: "legacy correction" })).toThrow(
    "Steering requires a run submitted with steering support",
  );
  for (const [index, op] of runtime
    .snapshot(id)
    .operations.filter((op) => op.kind === "model")
    .entries()) {
    expect(op.historyEncoding).toBeUndefined();
    expect(JSON.stringify(runtime.operationRequest(id, op.key))).toBe(fixture.requests[index]);
  }
  await runtime.resume();
  expect(await (await runtime.getRun(id)).result()).toMatchObject({ output: "done" });
  expect(model).toHaveBeenCalledTimes(1);
  expect(tool).not.toHaveBeenCalled();
  expect(
    runtime.snapshot(id).operations.find((op) => op.key === "0:model:2")?.historyEncoding,
  ).toBe("linked-v1");
  expect(JSON.stringify(runtime.operationRequest(id, "0:model:2"))).toBe(fixture.requests[1]);
});

it("rebuilds question-wait requests across close, reopen and response epochs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-question-journal-"));
  directories.push(directory);
  const path = join(directory, "journal.sqlite");
  const requests: string[] = [];
  const agent = makeAgent(
    async (request) => {
      requests.push(JSON.stringify(request));
      if (request.chatHistory.some((message) => message.role === "tool")) return done();
      return response([
        {
          type: "tool-call",
          toolCallId: "question-1",
          toolName: "ask_user",
          input: {
            questions: [{ id: "details", text: "Which report?" }],
          },
        },
      ]);
    },
    [createQuestionTool({ name: "ask_user", description: "Ask a question" })],
  );
  let runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  const handle = await runtime.submit({
    agentId: agent.id,
    sessionId: "session",
    requestId: "one",
    prompt: "Research",
  });
  await vi.waitFor(() => expect(runtime.status(handle.id).status).toBe("waiting"));
  const pending = runtime.run(handle.id).outcome;
  if (pending?.type !== "interaction") throw new Error("Expected question");
  await runtime.close();
  runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  const reopened = await runtime.getRun(handle.id);
  await reopened.respond(pending.interaction.id, {
    type: "tool-question",
    answers: [{ questionId: "details", value: "The annual report" }],
  });
  await reopened.result();
  expectJournalRequests(runtime, handle.id);
  const models = runtime.snapshot(handle.id).operations.filter((op) => op.kind === "model");
  expect(models).toHaveLength(2);
  models.forEach((op, index) =>
    expect(JSON.stringify(runtime.operationRequest(handle.id, op.key))).toBe(requests[index]),
  );
});

it("rolls back shared history with its operation and detects damaged log content", () => {
  const directory = mkdtempSync(join(tmpdir(), "anvia-log-atomic-"));
  directories.push(directory);
  const path = join(directory, "journal.sqlite");
  const store = new SqliteDurableStore(path);
  store.acquire();
  const operation = {
    key: "0:model:1",
    kind: "model" as const,
    status: "started" as const,
    recovery: "safe" as const,
    input: { request: { chatHistory: [{ role: "user", content: "hello" }] } },
  };
  const db = new DatabaseSync(path);
  try {
    expect(() =>
      store.transaction((tx) => {
        tx.putOperation("run", operation);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    for (const table of [
      "anvia_durable_operations",
      "anvia_durable_messages",
      "anvia_durable_histories",
    ])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
    store.transaction((tx) => tx.putOperation("run", operation));
    expect(store.transaction((tx) => tx.getOperation("run", operation.key))).toEqual(operation);
    db.prepare("UPDATE anvia_durable_messages SET record = ?").run(
      JSON.stringify({ role: "user", content: "changed" }),
    );
    expect(() => store.transaction((tx) => tx.getOperation("run", operation.key))).toThrow(
      "Corrupt operation history content",
    );
  } finally {
    db.close();
    store.close();
  }
});
