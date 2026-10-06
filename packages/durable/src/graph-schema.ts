import { z } from "zod";
import type { DurableGraphRecord, DurableGraphSubmission } from "./graph-types.js";

const id = z.string().refine((value) => value.trim().length > 0);
const taskId = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
const submissionSchema = z
  .object({
    sessionId: id,
    requestId: id,
    tasks: z
      .array(
        z
          .object({
            id: taskId,
            agentId: id,
            prompt: id,
            dependsOn: z.array(taskId).max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const graphListSchema = z
  .object({
    sessionId: id.optional(),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export function parseDurableGraphSubmission(value: unknown): DurableGraphSubmission {
  const parsed = submissionSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid durable graph submission.");
  const tasks = parsed.data.tasks.map((task) => ({ ...task, dependsOn: task.dependsOn ?? [] }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new TypeError("Duplicate task ID.");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new TypeError("Task dependencies contain a cycle.");
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (task === undefined) throw new TypeError(`Unknown task dependency: ${id}`);
    if (new Set(task.dependsOn).size !== task.dependsOn.length)
      throw new TypeError("Duplicate task dependency.");
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  return { ...parsed.data, tasks };
}

export function parseGraphRecord(value: unknown): DurableGraphRecord {
  const envelope = z
    .object({
      id,
      submission: z.unknown(),
      createdAt: z.iso.datetime(),
      cancelled: z.boolean(),
      runIds: z.record(taskId, id),
    })
    .strict()
    .parse(value);
  const submission = parseDurableGraphSubmission(envelope.submission);
  if (
    Object.keys(envelope.runIds).length !== submission.tasks.length ||
    submission.tasks.some((task) => !Object.hasOwn(envelope.runIds, task.id))
  )
    throw new TypeError("Graph task/run mapping is incomplete.");
  if (new Set(Object.values(envelope.runIds)).size !== submission.tasks.length)
    throw new TypeError("Graph contains duplicate run IDs.");
  return { ...envelope, submission };
}
