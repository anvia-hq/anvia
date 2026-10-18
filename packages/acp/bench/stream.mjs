// Opt-in, offline benchmark. From the repo root:
// node --expose-gc --import tsx packages/acp/bench/stream.mjs [turns=100] [chunks=512] [bytes=128]
import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import { getEventListeners } from "node:events";
import { SessionManager } from "../src/session-manager.ts";

const [turns, chunks, bytes] = process.argv.slice(2).map(Number);
const count = turns ?? 100;
const chunkCount = chunks ?? 512;
const chunkBytes = bytes ?? 128;
for (const value of [count, chunkCount, chunkBytes]) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Use positive integers.");
}
if (!globalThis.gc) throw new Error("Run with --expose-gc for comparable heap measurements.");
const delta = "x".repeat(chunkBytes);
const response = {
  choice: [{ type: "text", text: delta.repeat(chunkCount) }],
  usage: Usage.empty(),
  rawResponse: {},
};
const manager = new SessionManager({
  sessionFactory: () => ({
    agent: new Agent({
      id: "profile",
      retries: false,
      model: {
        provider: "fake",
        modelId: "profile",
        capabilities: { streaming: true, tools: false, toolChoice: false },
        async *streamCompletion() {
          for (let i = 0; i < chunkCount; i++) yield { type: "text_delta", delta };
          yield { type: "final", response };
        },
      },
    }),
    turnBudget: { maxDurationMs: 60_000 },
  }),
});
const id = await manager.create(process.cwd(), {
  readTextFile: false,
  writeTextFile: false,
  terminal: false,
  elicitationForm: false,
});
let session = manager.get(id);
globalThis.gc();
const before = process.memoryUsage().heapUsed;
let peak = before;
let updates = 0;
const started = performance.now();
for (let i = 0; i < count; i++) {
  await session.prompt([{ type: "text", text: `turn ${i}` }], async () => {
    updates++;
  });
  peak = Math.max(peak, process.memoryUsage().heapUsed);
}
const elapsedMs = performance.now() - started;
const listeners = getEventListeners(session.context.signal, "abort").length;
const pending = session.pendingRequests.size;
globalThis.gc();
const retained = process.memoryUsage().heapUsed;
await manager.close();
// Persistent history is intentionally retained by the store until explicitly deleted.
await manager.store.delete(id);
session = undefined;
await new Promise((resolve) => setImmediate(resolve));
globalThis.gc();
console.log(
  JSON.stringify(
    {
      node: process.version,
      turns: count,
      chunksPerTurn: chunkCount,
      chunkBytes,
      updates,
      elapsedMs: Math.round(elapsedMs),
      updatesPerSecond: Math.round((updates * 1000) / elapsedMs),
      outputMiB: (count * chunkCount * chunkBytes) / 1024 ** 2,
      heapMiB: {
        before: before / 1024 ** 2,
        peakSampled: peak / 1024 ** 2,
        retained: retained / 1024 ** 2,
        afterCloseAndDelete: process.memoryUsage().heapUsed / 1024 ** 2,
      },
      abortListeners: listeners,
      pendingRequests: pending,
    },
    null,
    2,
  ),
);
