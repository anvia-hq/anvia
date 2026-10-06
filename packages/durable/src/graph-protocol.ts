import { z } from "zod";
import { agentInteractionRequestSchema } from "@anvia/core/agent/interactions";
import { isJsonValue, type JsonValue } from "@anvia/core/completion";
import { runStatusSchema } from "./schema.js";
import { graphListSchema } from "./graph-schema.js";
import type {
  DurableGraphSnapshot,
  DurableGraphListOptions,
  DurableGraphPage,
} from "./graph-types.js";

export { parseDurableGraphSubmission } from "./graph-schema.js";
export type {
  DurableTask,
  DurableGraphSubmission,
  DurableGraphSnapshot,
  DurableGraphNode,
  DurableGraphEvent,
  DurableTaskWait,
  DurableGraphPage,
  DurableGraphListOptions,
} from "./graph-types.js";
const id = z.string().min(1);
const cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const wait = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dependencies"), taskIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ type: z.literal("dependency_failed"), taskIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ type: z.literal("capacity") }).strict(),
  z.object({ type: z.literal("interaction"), interactionId: id }).strict(),
  z.object({ type: z.literal("retry"), until: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("recovery"), operationId: id.optional() }).strict(),
]);
const node = z
  .object({
    id,
    agentId: id,
    runId: id,
    status: runStatusSchema,
    wait: wait.optional(),
    output: z.custom<JsonValue>(isJsonValue).optional(),
    interaction: agentInteractionRequestSchema.optional(),
    error: z.string().optional(),
  })
  .strict();
const snapshot = z
  .object({
    id,
    sessionId: id,
    requestId: id,
    createdAt: z.iso.datetime(),
    status: z.enum(["running", "waiting", "blocked", "completed", "cancelled"]),
    nodes: z.array(node).min(1).max(100),
    edges: z.array(z.object({ source: id, target: id }).strict()).max(10_000),
    cursor,
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid durable graph payload.");
  return parsed.data;
}
export function parseDurableGraphSnapshot(value: unknown): DurableGraphSnapshot {
  const parsed = parse(snapshot, value);
  const ids = new Set(parsed.nodes.map((node) => node.id));
  if (
    ids.size !== parsed.nodes.length ||
    new Set(parsed.nodes.map((node) => node.runId)).size !== parsed.nodes.length ||
    parsed.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
  )
    throw new TypeError("Invalid durable graph topology.");
  return parsed as DurableGraphSnapshot;
}
export function parseDurableGraphListOptions(value: unknown): DurableGraphListOptions {
  return parse(graphListSchema, value);
}
export function parseDurableGraphPage(value: unknown): DurableGraphPage {
  return parse(
    z
      .object({
        graphs: z
          .array(
            z.object({ id, sessionId: id, requestId: id, createdAt: z.iso.datetime() }).strict(),
          )
          .max(100),
        nextCursor: cursor.optional(),
      })
      .strict(),
    value,
  ) as DurableGraphPage;
}
