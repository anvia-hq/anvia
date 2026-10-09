import { DurableRuntime } from "../../src/index.js";
import { DurableStorageError } from "../../src/errors.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import type { DurableTransaction } from "../../src/types.js";
import type { JsonObject } from "@anvia/core/completion";
import { recoveryGoal } from "../goal-fixtures.js";

const [database, log, boundary, binding] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const { goal, registration } = recoveryGoal(
  log,
  binding === "override" ? "per-user" : "researcher",
);
if (binding === "legacy") {
  // Older controllers read the definition's agent directly, without pinning a phase first.
  const run = goal.registration.run;
  goal.registration.run = (ctx) =>
    run({
      ...ctx,
      checkpoint: { ...(ctx.checkpoint as JsonObject), agentId: "researcher" },
    });
}
const store = new SqliteDurableStore(database);
const transaction = store.transaction.bind(store);
let stopped = false;
store.transaction = <T>(callback: (tx: DurableTransaction) => T): T =>
  transaction((tx) =>
    callback({
      ...tx,
      putTask(task) {
        // Reproduce the original persisted goal shape, including its assessment journal.
        const persisted =
          binding === "legacy" && task.name === goal.name
            ? {
                ...task,
                checkpoint: Object.fromEntries(
                  Object.entries(task.checkpoint as JsonObject).filter(
                    ([key]) => key !== "agentId",
                  ),
                ),
              }
            : task;
        const state = task.checkpoint as { phase?: string; sessions?: number };
        const stop =
          task.name === goal.name &&
          ((boundary === "spawn" && state.phase === "session" && state.sessions === 0) ||
            (boundary === "assessment" && state.phase === "ready" && state.sessions === 1) ||
            (boundary === "rollover" && state.phase === "session" && state.sessions === 1));
        if (!stopped && stop) {
          stopped = true;
          process.send?.({ id: task.id });
          // Roll back this phase only. The earlier spawn/assessment transaction is committed.
          throw new DurableStorageError("Injected interruption at goal boundary");
        }
        tx.putTask(persisted);
      },
    }),
  );
const runtime = await DurableRuntime.open({ store, tasks: [goal], agents: [registration] });
await runtime.submitGoal(goal, {
  ...(binding === "override" ? { agentId: registration.agent.id } : {}),
  sessionId: "project",
  requestId: "goal",
  objective: "Create two artifacts",
  acceptanceCriteria: ["Both artifacts verified"],
  limits: { maxSessions: 3, maxTotalModelTurns: 4, maxConsecutiveNoProgressSessions: 2 },
});
setInterval(() => {}, 1000);
