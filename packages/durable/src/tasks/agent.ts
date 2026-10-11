import { promptSchema } from "../prompt.js";
import { z } from "zod";
import { isJsonValue, type JsonValue } from "@anvia/core/completion";
import { DurableConflictError, DurableNotFoundError } from "../errors.js";
import { json } from "../json.js";
import { createRunRecord } from "../run-record.js";
import type { DurableAgentRegistration, DurableTransaction } from "../types.js";
import { defineTask } from "./definition.js";
import { createTask, saveTask } from "./state.js";
import type { TaskAgentInput, TaskRecord } from "./types.js";

export const TASK_SESSION_PREFIX = "__anvia_task__:";
export const agentTask = defineTask({
  name: "anvia.agent",
  version: 1,
  input: z
    .object({
      agentId: z.string().min(1),
      prompt: z.union([z.string().min(1), promptSchema]),
      maxModelTurns: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      continueFrom: z.string().min(1).optional(),
    })
    .strict(),
  checkpoint: z.null(),
  output: z.custom<JsonValue>(isJsonValue),
  initial: () => null,
  run: async () => {
    throw new Error("Agent task is advanced by its owned run.");
  },
});

export function spawnAgent(
  tx: DurableTransaction,
  agents: ReadonlyMap<string, DurableAgentRegistration>,
  parent: TaskRecord,
  key: string,
  input: TaskAgentInput,
): string {
  const child = createTask(tx, agentTask.registration, input, parent.sessionId, key, parent.id);
  // Replaying a committed spawn needs its saved identity, not executable agent code.
  if (child.agentRunId !== undefined) return child.id;
  const registration = agents.get(input.agentId);
  if (registration === undefined)
    throw new DurableNotFoundError(`Unknown durable agent: ${input.agentId}`);
  const continued = input.continueFrom === undefined ? undefined : continuable(tx, parent, input);
  const run = createRunRecord(
    {
      agentId: input.agentId,
      prompt: input.prompt,
      sessionId: `${TASK_SESSION_PREFIX}${child.id}`,
      requestId: child.id,
    },
    registration,
  );
  if (input.maxModelTurns !== undefined)
    run.maxModelTurns = Math.min(run.maxModelTurns, input.maxModelTurns);
  if (continued !== undefined) run.continueFrom = continued;
  tx.putRun(run);
  tx.appendEvent(run.id, "submitted", json({ taskId: child.id, prompt: input.prompt }));
  child.agentRunId = run.id;
  child.status = "waiting";
  child.wait = { type: "agent", runId: run.id, status: run.status };
  saveTask(tx, child);
  return child.id;
}

/** The run of a finished sibling agent whose conversation a new child may continue. */
function continuable(tx: DurableTransaction, parent: TaskRecord, input: TaskAgentInput): string {
  const sibling = tx.taskChildren(parent.id).find((child) => child.key === input.continueFrom);
  const run = sibling?.agentRunId === undefined ? undefined : tx.getRun(sibling.agentRunId);
  if (run === undefined)
    throw new TypeError("continueFrom must name an agent child of the same task.");
  if (run.agentId !== input.agentId)
    throw new TypeError("continueFrom must name a run of the same agent.");
  if (run.status !== "completed" && run.exhaustion === undefined)
    throw new DurableConflictError(
      "continueFrom must name a completed or turn-limited run; its conversation is otherwise unsettled.",
    );
  return run.id;
}
