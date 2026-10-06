import { z } from "zod";
import { isJsonValue, type JsonValue } from "@anvia/core/completion";
import { parseTask, taskListSchema } from "./tasks/schema.js";
import { parseOperation } from "./schema.js";
import type { DurableOperation } from "./types.js";
import type { TaskRecord, TaskEvent, TaskGraphSnapshot, TaskPage } from "./tasks/types.js";

export type {
  TaskRecord,
  TaskEvent,
  TaskGraphSnapshot,
  TaskPage,
  TaskListOptions,
} from "./tasks/types.js";
export type TaskSnapshot = { task: TaskRecord; operations: DurableOperation[]; cursor: number };
const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value && value !== "__proto__");
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const json = z.custom<JsonValue>(isJsonValue);
const task = z.unknown().transform((value) => parseTask(value));
const submission = z
  .object({
    name: id,
    version: z.number().int().positive(),
    sessionId: id,
    requestId: id,
    input: json,
  })
  .strict();
export type TaskSubmission = z.infer<typeof submission>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (cause) {
    throw new TypeError("Invalid durable task payload.", { cause });
  }
}
export const parseTaskSubmission = (value: unknown): TaskSubmission => parse(submission, value);
export const parseTaskListOptions = (value: unknown) => parse(taskListSchema, value);
export const parseTaskSignal = (value: unknown) =>
  parse(z.object({ name: id, requestId: id, value: json }).strict(), value);
export const parseTaskResolution = (value: unknown) =>
  parse(z.object({ key: id, value: json }).strict(), value);
export const parseTaskSnapshot = (value: unknown): TaskSnapshot =>
  parse(
    z
      .object({
        task,
        operations: z.array(z.unknown().transform((value) => parseOperation(value))),
        cursor,
      })
      .strict(),
    value,
  );
export const parseTaskPage = (value: unknown): TaskPage =>
  parse(
    z.object({ tasks: z.array(task), nextCursor: cursor.optional() }).strict(),
    value,
  ) as TaskPage;
export const parseTaskEvent = (value: unknown): TaskEvent =>
  parse(
    z
      .object({
        rootId: id,
        taskId: id,
        sequence: cursor,
        createdAt: z.iso.datetime(),
        type: z.enum(["submitted", "status"]),
        data: json,
      })
      .strict(),
    value,
  );
export function parseTaskGraph(value: unknown): TaskGraphSnapshot {
  const graph = parse(
    z
      .object({
        rootId: id,
        nodes: z.array(task).min(1).max(1000),
        edges: z.array(
          z.object({ source: id, target: id, type: z.enum(["owns", "waits"]) }).strict(),
        ),
        cursor,
      })
      .strict(),
    value,
  );
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (
    ids.size !== graph.nodes.length ||
    !ids.has(graph.rootId) ||
    graph.nodes.some((node) => node.rootId !== graph.rootId) ||
    graph.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
  )
    throw new TypeError("Invalid durable task graph identities.");
  return graph;
}
