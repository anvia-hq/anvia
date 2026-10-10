// Run from the repository root: pnpm exec tsx packages/durable/test/journal-benchmark.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import type { JsonValue, Message } from "@anvia/core/completion";
import { DurableRuntime, type DurableOperation } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { createRunRecord } from "../src/run-record.js";
import { done, makeAgent } from "./helpers.js";

function median(callback: () => unknown) {
  for (let i = 0; i < 5; i++) callback();
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    callback();
    samples.push(performance.now() - start);
  }
  return Number(samples.sort((a, b) => a - b)[10]!.toFixed(3));
}

const directory = mkdtempSync(join(tmpdir(), "anvia-journal-benchmark-"));
try {
  for (const turns of [25, 50, 100]) {
    const path = join(directory, `${turns}.sqlite`);
    const store = new SqliteDurableStore(path);
    store.acquire();
    const run = createRunRecord(
      { agentId: "researcher", sessionId: "session", requestId: "one", prompt: "Research" },
      { agent: makeAgent(async () => done()), version: "1" },
    );
    run.status = "running";
    run.modelTurns = turns;
    const full: DurableOperation[] = [];
    const history: Message[] = [{ role: "user", content: "Research" }];
    store.transaction((tx) => {
      tx.putRun(run);
      for (let turn = 1; turn <= turns; turn++) {
        const operation: DurableOperation = {
          key: `0:model:${turn}`,
          kind: "model",
          status: "completed",
          recovery: "safe",
          input: {
            provider: "test",
            modelId: "test",
            request: { chatHistory: structuredClone(history), tools: [], documents: [] },
          } as unknown as JsonValue,
          result: { ...done(), rawResponse: null } as unknown as JsonValue,
        };
        full.push(operation);
        tx.putOperation(run.id, operation);
        history.push({
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: `call-${turn}`, toolName: "lookup", input: {} },
          ],
        });
        history.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: `call-${turn}`,
              toolName: "lookup",
              output: { type: "text", value: `${turn}:` + "x".repeat(10_000) },
            },
          ],
        });
      }
    });
    store.close();
    let runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path) });
    const compactSnapshotMs = median(() => runtime.snapshot(run.id));
    const runMs = median(() => runtime.run(run.id));
    const statusMs = median(() => runtime.status(run.id));
    const snapshotWithoutOperationsMs = median(() =>
      runtime.snapshot(run.id, { operations: false }),
    );
    await runtime.close();
    const db = new DatabaseSync(path);
    const size = (table: string, expression = "length(CAST(record AS BLOB))") =>
      Number(db.prepare(`SELECT coalesce(sum(${expression}), 0) AS n FROM ${table}`).get()!.n);
    const compactBytes =
      size("anvia_durable_operations") +
      size("anvia_durable_messages") +
      size(
        "anvia_durable_histories",
        "length(hash) + coalesce(length(previous), 0) + length(message)",
      );
    db.exec("BEGIN");
    for (const op of full)
      db.prepare("UPDATE anvia_durable_operations SET record = ? WHERE run_id = ? AND key = ?").run(
        JSON.stringify(op),
        run.id,
        op.key,
      );
    db.exec("COMMIT");
    const legacyBytes = size("anvia_durable_operations");
    db.close();
    runtime = await DurableRuntime.open({ store: new SqliteDurableStore(path) });
    const legacySnapshotMs = median(() => runtime.snapshot(run.id));
    await runtime.close();
    console.log(
      JSON.stringify({
        turns,
        legacyBytes,
        compactBytes,
        legacySnapshotMs,
        compactSnapshotMs,
        runMs,
        statusMs,
        snapshotWithoutOperationsMs,
      }),
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
