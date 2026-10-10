import { promptSchema } from "./prompt.js";
import type { DurableGraphEvent } from "./graph-types.js";
import { z } from "zod";
import {
  agentInteractionResponseSchema,
  parseAgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import { parseMessage, type ToolResultOutput } from "@anvia/core/completion";
import {
  eventTypeSchema,
  listOptionsSchema,
  parseOperation,
  parseRun,
  runSummarySchema,
} from "./schema.js";
import { json } from "./json.js";
import type { DurableEvent, DurableListOptions, DurableRunPage, DurableSnapshot } from "./types.js";

export type {
  DurableEvent,
  DurableListOptions,
  DurableRunPage,
  DurableRunSummary,
  DurableSnapshot,
  DurableSubmission,
  DurableSubmitOptions,
} from "./types.js";

const id = z.string().refine((value) => value.trim().length > 0);
const cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const submission = z
  .object({
    agentId: id,
    sessionId: id,
    requestId: id,
    prompt: promptSchema,
    enqueue: z.boolean().optional(),
  })
  .strict();
const response = z.object({ interactionId: id, response: agentInteractionResponseSchema }).strict();
const resolution = z.object({ operationId: id, output: z.unknown() }).strict();
const event = z
  .object({
    sequence: cursor,
    runId: id,
    createdAt: z.string(),
    type: eventTypeSchema,
    data: z.unknown(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError(`Invalid durable ${name}.`);
  return result.data;
}

export function parseDurableSubmission(value: unknown) {
  return parse(submission, value, "submission");
}
export function parseDurableResponse(value: unknown) {
  const body = parse(response, value, "interaction response");
  return {
    interactionId: body.interactionId,
    response: parseAgentInteractionResponse(body.response),
  };
}
export function parseDurableListOptions(value: unknown): DurableListOptions {
  return parse(listOptionsSchema, value, "list query");
}
export function parseDurableResolution(value: unknown): {
  operationId: string;
  output: ToolResultOutput;
} {
  const input = parse(resolution, value, "tool resolution");
  try {
    const message = parseMessage({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: input.operationId,
          toolName: "reconciled",
          output: input.output,
        },
      ],
    });
    if (message.role !== "tool" || message.content[0]?.type !== "tool-result") throw new Error();
    return { operationId: input.operationId, output: message.content[0].output };
  } catch {
    throw new TypeError("Invalid durable tool result.");
  }
}
export function parseDurableSnapshot(value: unknown): DurableSnapshot {
  const envelope = parse(
    z.object({ run: z.unknown(), operations: z.array(z.unknown()), cursor }).strict(),
    value,
    "snapshot",
  );
  return {
    run: parseRun(envelope.run),
    operations: envelope.operations.map(parseOperation),
    cursor: envelope.cursor,
  };
}
export function parseDurableEvent(value: unknown): DurableEvent {
  const parsed = parse(event, value, "event");
  return { ...parsed, data: json(parsed.data) };
}
export function parseDurableRunPage(value: unknown): DurableRunPage {
  return parse(
    z.object({ runs: z.array(runSummarySchema).max(100), nextCursor: cursor.optional() }).strict(),
    value,
    "run page",
  ) as DurableRunPage;
}
export {
  parseDurableGraphSubmission,
  parseDurableGraphSnapshot,
  parseDurableGraphListOptions,
  parseDurableGraphPage,
} from "./graph-protocol.js";
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

export function parseDurableGraphEvent(value: unknown): DurableGraphEvent {
  const { graphId, taskId, ...event } = parse(
    z.object({ graphId: id, taskId: id }).passthrough(),
    value,
    "graph event",
  );
  return { ...parseDurableEvent(event), graphId, taskId };
}

export * from "./task-protocol.js";
