import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().refine((value) => value.trim().length > 0);

export const goalLimitsSchema = z
  .object({
    // A task ownership tree has a maximum of 1000 nodes, including the goal itself.
    maxSessions: count.min(1).max(999),
    maxTotalModelTurns: count.min(1),
    maxConsecutiveNoProgressSessions: count.min(1),
    /** Admission threshold checked between sessions; one session can exceed it. */
    maxTotalTokens: count.min(1).optional(),
    /** Admission deadline checked between sessions, including after a restart. */
    deadline: z.iso.datetime().optional(),
  })
  .strict();

/** Returned by trusted assessment code, not accepted directly as a model's completion claim. */
export const goalDecisionSchema = z
  .object({
    status: z.enum(["continue", "complete", "blocked"]),
    summary: text,
    next: z.string(),
    /** Application-defined evidence of progress, such as a verified test count or artifact hash. */
    progressKey: text,
    evidence: z.array(z.string()),
  })
  .strict();

export const goalInputSchema = z
  .object({
    agentId: text.optional(),
    objective: text,
    acceptanceCriteria: z.array(text).min(1),
    limits: goalLimitsSchema,
  })
  .strict();

export const goalPauseReasonSchema = z.enum([
  "max_sessions",
  "max_model_turns",
  "max_tokens",
  "deadline",
  "no_progress",
  "blocked",
  "session_failed",
]);

export const goalCheckpointSchema = z
  .object({
    /** Captured on submission; absent only in goals persisted by older versions. */
    agentId: text.optional(),
    phase: z.enum(["ready", "session", "paused"]),
    sessions: count,
    modelTurns: count,
    totalTokens: count,
    noProgressSessions: count,
    handoff: goalDecisionSchema.nullable(),
    childId: z.string().nullable(),
    pauseReason: goalPauseReasonSchema.nullable(),
    resumeIndex: count,
    feedback: z.string(),
    limits: goalLimitsSchema,
  })
  .strict();

/** Send to the signal name exposed by the paused goal's task.wait. */
export const goalResumeSchema = z
  .object({
    feedback: text,
    /** Replace limits explicitly; cumulative usage and session counts are never reset. */
    limits: goalLimitsSchema.optional(),
  })
  .strict();

export const goalResultSchema = z
  .object({
    handoff: goalDecisionSchema.extend({ status: z.literal("complete") }),
    sessions: count,
    modelTurns: count,
    totalTokens: count,
  })
  .strict();

export type GoalLimits = z.infer<typeof goalLimitsSchema>;
export type GoalDecision = z.infer<typeof goalDecisionSchema>;
export type GoalInput = z.infer<typeof goalInputSchema>;
export type GoalCheckpoint = z.infer<typeof goalCheckpointSchema>;
export type GoalResult = z.infer<typeof goalResultSchema>;
export type GoalResume = z.infer<typeof goalResumeSchema>;
export type GoalPauseReason = z.infer<typeof goalPauseReasonSchema>;
