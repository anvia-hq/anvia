import { z } from "zod";
import type { AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import type { AgentRunExecution } from "@anvia/core/internal/agent";
import { messageSchema } from "@anvia/core/completion";
import { DurableConflictError, DurableRecoveryError } from "./errors.js";
import { json, sameJson } from "./json.js";
import { promptMessage, promptSchema } from "./prompt.js";
import type {
  DurableRunRecord,
  DurableSteerOptions,
  DurableStore,
  DurableTransaction,
} from "./types.js";

const id = z.string().refine((value) => value.trim().length > 0);
const userMessage = messageSchema.transform((message, context) => {
  if (message.role === "user") return message;
  context.addIssue({ code: "custom", message: "Steering requires user messages." });
  return z.NEVER;
});
const inputSchema = z.union([
  z.object({ prompt: promptSchema }).strict(),
  z.object({ messages: z.array(userMessage).min(1) }).strict(),
]);
const optionsSchema = z.object({ requestId: id.optional() }).strict();
const entry = z.object({ id, messages: z.array(userMessage).min(1) }).strict();
export const steeringStateSchema = z
  .object({
    pending: z.array(entry),
    checkpoints: z.record(
      z.string(),
      z
        .object({
          turn: z.number().int().nonnegative(),
          closing: z.boolean(),
          entries: z.array(entry),
        })
        .strict(),
    ),
    closed: z.boolean(),
  })
  .strict();

/** Transport envelope for run.steer(body.input, { requestId: body.requestId }). */
export function parseDurableSteering(value: unknown): {
  input: AgentSteerInput;
  requestId?: string;
} {
  const parsed = z
    .object({ input: inputSchema, requestId: id.optional() })
    .strict()
    .safeParse(json(value));
  if (!parsed.success) throw new TypeError("Invalid durable steering input.");
  return {
    input: parsed.data.input,
    ...(parsed.data.requestId === undefined ? {} : { requestId: parsed.data.requestId }),
  };
}

export function parseDurableSteerReceipt(value: unknown): AgentSteerReceipt {
  const parsed = z
    .object({ id, status: z.literal("queued") })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid durable steering receipt.");
  return parsed.data;
}

export function queueSteering(
  tx: DurableTransaction,
  run: DurableRunRecord,
  input: AgentSteerInput,
  options: DurableSteerOptions,
): AgentSteerReceipt {
  const parsed = inputSchema.safeParse(json(input));
  const parsedOptions = optionsSchema.safeParse(json(options));
  if (!parsed.success || !parsedOptions.success)
    throw new TypeError("Invalid durable steering input.");
  const messages =
    "prompt" in parsed.data ? [promptMessage(parsed.data.prompt)] : parsed.data.messages;
  const requestId = parsedOptions.data.requestId ?? globalThis.crypto.randomUUID();
  const state = run.steering;
  if (state === undefined)
    throw new DurableConflictError("Steering requires a run submitted with steering support.");
  const previous = [
    ...state.pending,
    ...Object.values(state.checkpoints).flatMap((checkpoint) => checkpoint.entries),
  ].find((entry) => entry.id === requestId);
  if (previous !== undefined) {
    if (!sameJson(previous.messages, messages))
      throw new DurableConflictError("Steering request already received different input.");
    return { id: requestId, status: "queued" };
  }
  if (state.closed || ["completed", "failed", "cancelled"].includes(run.status))
    throw new DurableConflictError("Durable run is no longer accepting steering input.");
  state.pending.push({ id: requestId, messages });
  run.updatedAt = new Date().toISOString();
  tx.putRun(run);
  tx.appendEvent(run.id, "steering_queued", { id: requestId });
  return { id: requestId, status: "queued" };
}

/** Persist before returning to core; replay both populated and empty boundaries exactly. */
export function createSteeringDrain(
  store: DurableStore,
  run: DurableRunRecord,
  signal: AbortSignal,
): NonNullable<AgentRunExecution["drainSteering"]> {
  let boundary = 0;
  return (turn, closing) => {
    signal.throwIfAborted();
    const key = `${run.epoch}:${boundary++}`;
    return store.transaction((tx) => {
      const current = tx.getRun(run.id)!;
      const state = current.steering!;
      const previous = state.checkpoints[key];
      if (previous !== undefined) {
        if (previous.turn !== turn || previous.closing !== closing)
          throw new DurableRecoveryError("Steering changed at a saved checkpoint.");
        return previous.entries;
      }
      if (current.status !== "running") throw new Error("Durable run is no longer running.");
      const entries = state.pending.splice(0);
      state.checkpoints[key] = { turn, closing, entries };
      // Fence the gap between core's final drain and the durable outcome commit.
      if (closing && entries.length === 0) state.closed = true;
      tx.putRun(current);
      for (const entry of entries)
        tx.appendEvent(run.id, "steering_applied", { id: entry.id, epoch: run.epoch, turn });
      return entries;
    });
  };
}
