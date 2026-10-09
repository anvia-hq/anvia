import { promptSchema } from "./prompt.js";
import { z } from "zod";
import {
  agentContinuationSchema,
  agentInteractionRequestSchema,
  agentInteractionResponseSchema,
} from "@anvia/core/agent/interactions";
import { isJsonValue, messagesSchema, parseMessage, type JsonValue } from "@anvia/core/completion";
import type { DurableOperation, DurableRunRecord } from "./types.js";

const jsonValue = z.custom<JsonValue>(isJsonValue);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const usage = z.object({
  inputTokens: count,
  outputTokens: count,
  totalTokens: count,
  cachedInputTokens: count,
  cacheCreationInputTokens: count,
  details: z.record(z.string(), z.number().finite()).optional(),
});
const outcomeBase = {
  runId: id,
  text: z.string(),
  usage,
  messages: messagesSchema,
};
const outcome = z.discriminatedUnion("type", [
  z.object({ ...outcomeBase, type: z.literal("response"), output: jsonValue }).passthrough(),
  z
    .object({
      ...outcomeBase,
      type: z.literal("interaction"),
      interaction: agentInteractionRequestSchema,
      continuation: agentContinuationSchema,
    })
    .passthrough(),
  z
    .object({
      ...outcomeBase,
      type: z.literal("blocked"),
      stage: z.enum(["input", "output"]),
      reason: z.string(),
    })
    .passthrough(),
]);

export const runStatusSchema = z.enum([
  "queued",
  "retry_wait",
  "pending",
  "running",
  "waiting",
  "needs_attention",
  "completed",
  "failed",
  "cancelled",
]);
export const modelRetrySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(100),
    initialDelayMs: z.number().int().min(1).max(86_400_000),
    maxDelayMs: z.number().int().min(1).max(86_400_000),
  })
  .strict()
  .refine(
    (value) => value.maxDelayMs >= value.initialDelayMs,
    "maxDelayMs must be at least initialDelayMs",
  );
export const compactionPolicySchema = z
  .object({
    trigger: z
      .object({ afterTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
      .strict(),
    retention: z
      .object({
        recentTurns: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
        recentToolTurns: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const contextCheckpointSchema = z
  .object({
    summary: z.string().trim().min(1),
    compactedMessageCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const listOptionsSchema = z
  .object({
    sessionId: id.optional(),
    agentId: id.optional(),
    status: runStatusSchema.optional(),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const runSchema = z
  .object({
    id,
    agentId: id,
    sessionId: id,
    requestId: id,
    // Older owned-agent submissions permitted whitespace-only string prompts.
    prompt: z.union([z.string(), promptSchema]),
    version: id,
    status: runStatusSchema,
    createdAt: id,
    updatedAt: id,
    startedAt: z.iso.datetime().optional(),
    graphId: id.optional(),
    taskId: id.optional(),
    dependencies: z.array(id).max(100).optional(),
    epoch: count,
    modelTurns: count,
    maxModelTurns: count,
    usage,
    history: messagesSchema,
    compaction: compactionPolicySchema.optional(),
    contextCheckpoint: contextCheckpointSchema.optional(),
    contextPrepared: z.boolean().optional(),
    loopCompaction: z.boolean().optional(),
    responses: z.record(z.string(), jsonValue),
    input: z.union([
      z.object({ messages: messagesSchema.min(1) }).strict(),
      z
        .object({ continuation: agentContinuationSchema, response: agentInteractionResponseSchema })
        .strict(),
    ]),
    outcome: outcome.optional(),
    error: z.string().optional(),
    exhaustion: z
      .object({ reason: z.literal("max_turns"), messages: messagesSchema })
      .strict()
      .optional(),
    blockedOperation: id.optional(),
    modelRetry: modelRetrySchema.optional(),
    nextAttemptAt: z.iso.datetime().optional(),
    stream: z.boolean().optional(),
  })
  .strict();

export function parseRun(value: unknown): DurableRunRecord {
  // The core owns richer optional outcome fields; the envelope and execution state are checked here.
  const run = runSchema.parse(value) as DurableRunRecord;
  if (
    (run.graphId === undefined) !== (run.taskId === undefined) ||
    (run.graphId === undefined) !== (run.dependencies === undefined)
  )
    throw new Error("Incomplete graph task metadata.");
  if (run.status === "retry_wait" && run.nextAttemptAt === undefined)
    throw new Error("Retrying run has no deadline.");
  if (run.status === "waiting" && run.outcome?.type !== "interaction")
    throw new Error("Waiting run has no interaction.");
  if (
    run.status === "completed" &&
    (run.outcome === undefined || run.outcome.type === "interaction")
  )
    throw new Error("Completed run has no terminal outcome.");
  if ((run.contextCheckpoint?.compactedMessageCount ?? 0) > run.history.length)
    throw new Error("Compaction checkpoint exceeds canonical history.");
  return run;
}

const operationSchema = z
  .object({
    key: id,
    kind: z.enum(["model", "tool", "effect", "compaction", "context"]),
    input: jsonValue,
    status: z.enum(["started", "completed"]),
    recovery: z.enum(["safe", "idempotent", "manual"]),
    result: jsonValue.optional(),
    attempts: count.optional(),
    attemptId: id.optional(),
  })
  .strict();

export function parseOperation(value: unknown): DurableOperation {
  const operation = operationSchema.parse(value);
  if (operation.status !== "completed") return operation;
  if (operation.result === undefined) throw new Error("Completed operation has no result.");
  if (operation.kind === "model") {
    const result = z
      .object({ choice: z.array(jsonValue), usage, rawResponse: z.null() })
      .passthrough()
      .parse(operation.result);
    parseMessage({ role: "assistant", content: result.choice });
  } else if (operation.kind === "context") {
    const prepared = preparedLoopContextSchema.parse(operation.result);
    const input = messagesSchema.parse(operation.input);
    if ((prepared.checkpoint?.coveredMessages ?? 0) > input.length)
      throw new Error("Context checkpoint exceeds its source transcript.");
  } else if (operation.kind === "compaction") {
    contextCheckpointSchema.parse(operation.result);
  } else if (operation.kind === "tool") {
    const result = z
      .discriminatedUnion("failed", [
        z.object({ failed: z.literal(false), output: jsonValue }).strict(),
        z.object({ failed: z.literal(true), output: jsonValue, error: z.string() }).strict(),
      ])
      .parse(operation.result);
    parseMessage({
      role: "tool",
      content: [
        { type: "tool-result", toolName: "saved", toolCallId: "saved", output: result.output },
      ],
    });
  }
  return operation;
}

export const eventTypeSchema = z.enum([
  "submitted",
  "status",
  "model_started",
  "model_attempt_started",
  "model_delta",
  "model_attempt_failed",
  "model_completed",
  "tool_started",
  "tool_completed",
  "compaction_started",
  "compaction_completed",
]);

export const preparedLoopContextSchema = z
  .object({
    messages: messagesSchema.min(1),
    checkpoint: z
      .object({
        summary: z.string().trim().min(1),
        coveredMessages: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        compactedMessageCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .optional(),
    compaction: z
      .object({
        originalMessageCount: count,
        compactedMessageCount: count,
        retainedMessageCount: count,
        originalTokenCount: count,
        compactedTokenCount: count,
        retainedTokenCount: count,
        resultTokenCount: count,
        attempts: count,
        usage: usage.transform(({ details, ...value }) =>
          details === undefined ? value : { ...value, details },
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
