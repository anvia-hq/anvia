import { z } from "zod";
import { isJsonValue } from "../completion/json";
import type { JsonObject, JsonValue, ToolQuestionAnswer } from "../completion/types";

export type AgentQuestionChoice = Readonly<{
  label: string;
  value: string;
}>;

export type AgentQuestionPrompt = Readonly<{
  id: string;
  text: string;
  choices?: readonly AgentQuestionChoice[];
  allowCustom?: boolean;
}>;

export type AgentQuestionAnswer = ToolQuestionAnswer;

type AgentInteractionRequestBase = Readonly<{
  id: string;
  toolName: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
}>;

export type AgentToolApprovalRequest = AgentInteractionRequestBase &
  Readonly<{
    type: "tool-approval";
    input: JsonValue;
    reason?: string;
  }>;

export type AgentToolQuestionRequest = AgentInteractionRequestBase &
  Readonly<{
    type: "tool-question";
    questions: readonly AgentQuestionPrompt[];
  }>;

export type AgentInteractionRequest = AgentToolApprovalRequest | AgentToolQuestionRequest;

export type AgentInteractionResponse =
  | Readonly<{
      type: "tool-approval";
      approved: boolean;
      reason?: string;
    }>
  | Readonly<{
      type: "tool-question";
      answers: readonly AgentQuestionAnswer[];
    }>;

export type AgentContinuation = Readonly<{
  version: 1;
  agentId: string;
  sourceRunId: string;
  interaction: AgentInteractionRequest;
  state: JsonObject;
}>;

const nonblank = z.string().trim().min(1);
const jsonValueSchema = z.custom<JsonValue>(isJsonValue, {
  message: "Expected a strict JSON value",
});
const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value),
  { message: "Expected a strict JSON object" },
);

const questionChoiceSchema = z
  .object({
    label: nonblank,
    value: nonblank,
  })
  .strict();

const questionPromptSchema = z
  .object({
    id: nonblank,
    text: nonblank,
    choices: z.array(questionChoiceSchema).min(1).optional(),
    allowCustom: z.boolean().optional(),
  })
  .strict()
  .superRefine((question, context) => {
    if (question.choices === undefined && question.allowCustom === false) {
      context.addIssue({
        code: "custom",
        message: "A free-text question cannot disable custom answers.",
        path: ["allowCustom"],
      });
    }
    const values = new Set<string>();
    for (const [index, choice] of (question.choices ?? []).entries()) {
      if (values.has(choice.value)) {
        context.addIssue({
          code: "custom",
          message: "Question choice values must be unique.",
          path: ["choices", index, "value"],
        });
      }
      values.add(choice.value);
    }
  });

const questionAnswerSchema = z
  .object({
    questionId: nonblank,
    value: nonblank,
  })
  .strict();

const interactionBase = {
  id: nonblank,
  toolName: nonblank,
  toolCallId: nonblank,
  callId: z.string().optional(),
  internalCallId: nonblank,
};

const approvalRequestSchema = z
  .object({
    type: z.literal("tool-approval"),
    ...interactionBase,
    input: jsonValueSchema,
    reason: z.string().optional(),
  })
  .strict();

const questionRequestSchema = z
  .object({
    type: z.literal("tool-question"),
    ...interactionBase,
    questions: z.array(questionPromptSchema).min(1),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    for (const [index, question] of request.questions.entries()) {
      if (ids.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "Question IDs must be unique.",
          path: ["questions", index, "id"],
        });
      }
      ids.add(question.id);
    }
  });

export const agentInteractionRequestSchema = z.discriminatedUnion("type", [
  approvalRequestSchema,
  questionRequestSchema,
]);

export const agentInteractionResponseSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("tool-approval"),
      approved: z.boolean(),
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-question"),
      answers: z.array(questionAnswerSchema),
    })
    .strict(),
]);

export const agentContinuationSchema = z
  .object({
    version: z.literal(1),
    agentId: nonblank,
    sourceRunId: nonblank,
    interaction: agentInteractionRequestSchema,
    state: jsonObjectSchema,
  })
  .strict();

export function parseAgentInteractionRequest(value: unknown): AgentInteractionRequest {
  return freeze(agentInteractionRequestSchema.parse(value)) as AgentInteractionRequest;
}

export function parseAgentInteractionResponse(value: unknown): AgentInteractionResponse {
  return freeze(agentInteractionResponseSchema.parse(value)) as AgentInteractionResponse;
}

export function parseAgentQuestionPrompts(value: unknown): readonly AgentQuestionPrompt[] {
  const request = questionRequestSchema.parse({
    type: "tool-question",
    id: "validation",
    toolName: "validation",
    toolCallId: "validation",
    internalCallId: "validation",
    questions: value,
  });
  return freeze(request.questions) as readonly AgentQuestionPrompt[];
}

export function parseAgentContinuation(value: unknown): AgentContinuation {
  return freeze(agentContinuationSchema.parse(value)) as AgentContinuation;
}

export function assertAgentInteractionResponse(
  request: AgentInteractionRequest,
  response: AgentInteractionResponse,
): void {
  if (request.type !== response.type) {
    throw new TypeError("Interaction response type does not match the pending request.");
  }
  if (request.type === "tool-question" && response.type === "tool-question") {
    assertQuestionAnswers(request, response.answers);
  }
}

function assertQuestionAnswers(
  request: AgentToolQuestionRequest,
  answers: readonly AgentQuestionAnswer[],
): void {
  const parsed = answers.map((answer) => questionAnswerSchema.parse(answer));
  const byId = new Map(parsed.map((answer) => [answer.questionId, answer]));
  if (byId.size !== parsed.length) {
    throw new TypeError("Question answers must not contain duplicate question IDs.");
  }
  if (byId.size !== request.questions.length) {
    throw new TypeError("Question responses must answer every question exactly once.");
  }
  for (const question of request.questions) {
    const answer = byId.get(question.id);
    if (answer === undefined) {
      throw new TypeError(`Question response is missing an answer for "${question.id}".`);
    }
    const choices = question.choices;
    if (
      choices !== undefined &&
      question.allowCustom !== true &&
      !choices.some((choice) => choice.value === answer.value)
    ) {
      throw new TypeError(`Question "${question.id}" requires one of its configured choices.`);
    }
  }
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
