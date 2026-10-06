import { z } from "zod";
import { isJsonValue, type JsonValue } from "@anvia/core/completion";
import { json } from "../json.js";
import type { TaskRecord } from "./types.js";
import { runStatusSchema } from "../schema.js";

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim() && value !== "__proto__", "Invalid task identifier");
const value = z.custom<JsonValue>(isJsonValue);
export const taskWaitSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("children"),
      ids: z.array(id).max(1000),
      policy: z.enum(["allSettled", "failFast"]),
    })
    .strict(),
  z.object({ type: z.literal("timer"), until: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("signal"), name: id }).strict(),
  z.object({ type: z.literal("agent"), runId: id, status: runStatusSchema }).strict(),
]);
const outcome = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), output: value }).strict(),
  z.object({ status: z.literal("failed"), error: z.string() }).strict(),
  z.object({ status: z.literal("cancelled"), error: z.string() }).strict(),
]);
export const taskListSchema = z
  .object({
    sessionId: id.optional(),
    after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const record = z
  .object({
    id,
    rootId: id,
    parentId: id.optional(),
    agentRunId: id.optional(),
    depth: z.number().int().min(0).max(32),
    sessionId: id,
    key: id,
    name: id,
    version: z.number().int().positive(),
    submissionVersion: z.number().int().positive(),
    submissionInput: value,
    input: value,
    checkpoint: value,
    status: z.enum([
      "pending",
      "running",
      "waiting",
      "completing",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "needs_attention",
    ]),
    wait: taskWaitSchema.optional(),
    outcome: outcome.optional(),
    error: z.string().optional(),
    blockedOperation: z.string().optional(),
    signals: z.record(id, z.object({ requestId: id, value }).strict()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((task, context) => {
    if ((task.status === "waiting") !== (task.wait !== undefined))
      context.addIssue({ code: "custom", message: "Only waiting tasks have a wait." });
    const finishing = ["completing", "cancelling", "completed", "failed", "cancelled"].includes(
      task.status,
    );
    if (finishing !== (task.outcome !== undefined))
      context.addIssue({ code: "custom", message: "Finishing tasks must have an outcome." });
    if (
      ["completed", "failed", "cancelled"].includes(task.status) &&
      task.status !== task.outcome?.status
    )
      context.addIssue({ code: "custom", message: "Task outcome and status disagree." });
  });
export function parseTask(value: unknown): TaskRecord {
  return record.parse(json(value)) as TaskRecord;
}
