import { DurableRuntime } from "../../src/index.js";
import { DurableStorageError } from "../../src/errors.js";
import { SqliteDurableStore } from "../../src/sqlite.js";
import type { DurableTransaction } from "../../src/types.js";
import { recoveryGoal } from "../goal-fixtures.js";

const [database, log, boundary] = process.argv.slice(2) as [string, string, string];
const { goal, registration } = recoveryGoal(log);
const store = new SqliteDurableStore(database);
const transaction = store.transaction.bind(store);
let stopped = false;
store.transaction = <T>(callback: (tx: DurableTransaction) => T): T =>
  transaction((tx) =>
    callback({
      ...tx,
      putTask(task) {
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
        tx.putTask(task);
      },
    }),
  );
const runtime = await DurableRuntime.open({ store, tasks: [goal], agents: [registration] });
await runtime.submitGoal(goal, {
  sessionId: "project",
  requestId: "goal",
  objective: "Create two artifacts",
  acceptanceCriteria: ["Both artifacts verified"],
  limits: { maxSessions: 3, maxTotalModelTurns: 4, maxConsecutiveNoProgressSessions: 2 },
});
setInterval(() => {}, 1000);
