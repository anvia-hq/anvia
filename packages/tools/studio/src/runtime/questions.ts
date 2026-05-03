import type { JsonObject, JsonValue, PromptHook } from "@anvia/core";
import { createHook, parseToolArgs } from "@anvia/core";
import type { Context, Hono } from "hono";
import type {
  AgentRunStreamEvent,
  StudioToolQuestion,
  StudioToolQuestionAnswer,
  StudioToolQuestionChoice,
  StudioToolQuestionPrompt,
  StudioToolQuestionStatus,
} from "../types";
import { errorResponse, isObject, optionalQueryString } from "./shared";

type PendingQuestion = StudioToolQuestion & {
  status: "pending";
  emit?: (event: AgentRunStreamEvent) => void;
  resolve: (answers: StudioToolQuestionAnswer[]) => void;
};

type QuestionHookContext = {
  runId: string;
  agentId: string;
  sessionId?: string;
  metadata?: JsonObject;
  emit?: (event: AgentRunStreamEvent) => void;
};

type QuestionRequest = {
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  args: string;
  questions: StudioToolQuestionPrompt[];
};

export type QuestionRuntime = {
  questions: Map<string, PendingQuestion | StudioToolQuestion>;
  createHook(context: QuestionHookContext): PromptHook;
  list(options: QuestionListOptions): StudioToolQuestion[];
  answer(
    id: string,
    answers: StudioToolQuestionAnswer[],
  ): "missing" | "resolved" | StudioToolQuestion;
};

type QuestionListOptions = {
  status?: "pending" | "resolved";
  runId?: string;
  agentId?: string;
  sessionId?: string;
};

export function registerQuestionRoutes(app: Hono, questions: QuestionRuntime): void {
  app.get("/questions", (c) => {
    const status = parseQuestionStatus(c.req.query("status"));
    if (status === false) {
      return errorResponse(c, 400, "bad_request", "status must be pending or resolved");
    }

    const options: QuestionListOptions = {};
    const runId = optionalQueryString(c.req.query("runId"));
    const agentId = optionalQueryString(c.req.query("agentId"));
    const sessionId = optionalQueryString(c.req.query("sessionId"));
    if (status !== undefined) {
      options.status = status;
    }
    if (runId !== undefined) {
      options.runId = runId;
    }
    if (agentId !== undefined) {
      options.agentId = agentId;
    }
    if (sessionId !== undefined) {
      options.sessionId = sessionId;
    }

    return c.json({ questions: questions.list(options) });
  });

  app.post("/questions/:questionId/answer", async (c) => {
    const body = await parseQuestionAnswerRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const result = questions.answer(c.req.param("questionId"), body.answers);
    if (result === "missing") {
      return errorResponse(c, 404, "not_found", "Question not found");
    }
    if (result === "resolved") {
      return errorResponse(c, 409, "conflict", "Question is already answered");
    }
    return c.json(result);
  });
}

function parseQuestionStatus(
  value: string | undefined,
): "pending" | "resolved" | undefined | false {
  const status = optionalQueryString(value);
  if (status === undefined) {
    return undefined;
  }
  return status === "pending" || status === "resolved" ? status : false;
}

async function parseQuestionAnswerRequest(
  c: Context,
): Promise<{ answers: StudioToolQuestionAnswer[] } | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }
  if (!Array.isArray(body.answers)) {
    return { error: errorResponse(c, 400, "bad_request", "answers must be an array") };
  }

  const answers: StudioToolQuestionAnswer[] = [];
  for (const answer of body.answers) {
    if (!isObject(answer)) {
      return { error: errorResponse(c, 400, "bad_request", "answers must contain objects") };
    }
    if (typeof answer.questionId !== "string" || answer.questionId.trim().length === 0) {
      return { error: errorResponse(c, 400, "bad_request", "questionId must be a string") };
    }
    if (typeof answer.answer !== "string" || answer.answer.trim().length === 0) {
      return { error: errorResponse(c, 400, "bad_request", "answer must be a string") };
    }
    if ("choice" in answer && typeof answer.choice !== "string") {
      return { error: errorResponse(c, 400, "bad_request", "choice must be a string") };
    }
    if ("custom" in answer && typeof answer.custom !== "boolean") {
      return { error: errorResponse(c, 400, "bad_request", "custom must be a boolean") };
    }
    answers.push({
      questionId: answer.questionId.trim(),
      answer: answer.answer.trim(),
      ...(typeof answer.choice === "string" ? { choice: answer.choice } : {}),
      ...(typeof answer.custom === "boolean" ? { custom: answer.custom } : {}),
    });
  }

  return { answers };
}

export function createQuestionRuntime(): QuestionRuntime {
  const questions = new Map<string, PendingQuestion | StudioToolQuestion>();

  return {
    questions,
    createHook(context) {
      return createHook({
        async onToolCall({ toolName, toolCallId, internalCallId, args, tool: control }) {
          if (toolName !== "ask_question") {
            return control.run();
          }

          const prompts = normalizeQuestionPrompts(parseToolArgs(args));
          if ("error" in prompts) {
            return control.skip(prompts.error);
          }

          const answers = await requestQuestion(questions, context, {
            toolName,
            ...(toolCallId === undefined ? {} : { toolCallId }),
            internalCallId,
            args,
            questions: prompts.questions,
          });

          return control.skip(JSON.stringify({ answers }));
        },
      });
    },
    list(options) {
      return [...questions.values()]
        .filter((question) => {
          if (options.status === "pending" && question.status !== "pending") {
            return false;
          }
          if (options.status === "resolved" && question.status === "pending") {
            return false;
          }
          if (options.runId !== undefined && question.runId !== options.runId) {
            return false;
          }
          if (options.agentId !== undefined && question.agentId !== options.agentId) {
            return false;
          }
          if (options.sessionId !== undefined && question.sessionId !== options.sessionId) {
            return false;
          }
          return true;
        })
        .map(publicQuestion);
    },
    answer(id, answers) {
      const question = questions.get(id);
      if (question === undefined) {
        return "missing";
      }
      if (!isPendingQuestion(question)) {
        return "resolved";
      }

      const resolved = resolveQuestion(question, answers);
      questions.set(id, resolved);
      question.emit?.({ type: "tool_question_result", question: resolved });
      question.resolve(answers);
      return publicQuestion(resolved);
    },
  };
}

async function requestQuestion(
  questions: Map<string, PendingQuestion | StudioToolQuestion>,
  context: QuestionHookContext,
  request: QuestionRequest,
): Promise<StudioToolQuestionAnswer[]> {
  const id = globalThis.crypto.randomUUID();
  const question: PendingQuestion = {
    id,
    runId: context.runId,
    agentId: context.agentId,
    ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
    toolName: request.toolName,
    ...(request.toolCallId === undefined ? {} : { callId: request.toolCallId }),
    internalCallId: request.internalCallId,
    args: request.args,
    questions: request.questions,
    status: "pending",
    requestedAt: new Date().toISOString(),
    ...(context.emit === undefined ? {} : { emit: context.emit }),
    resolve: () => {},
  };

  const answer = new Promise<StudioToolQuestionAnswer[]>((resolve) => {
    question.resolve = (answers) => {
      resolve(answers);
    };
  });

  questions.set(id, question);
  context.emit?.({ type: "tool_question_request", question: publicQuestion(question) });
  return answer;
}

function normalizeQuestionPrompts(
  args: JsonValue,
): { questions: StudioToolQuestionPrompt[] } | { error: string } {
  if (!isObject(args)) {
    return { error: "ask_question requires a JSON object with questions." };
  }

  const rawQuestions = Array.isArray(args.questions) ? args.questions : [args];
  if (rawQuestions.length === 0) {
    return { error: "ask_question requires at least one question." };
  }

  const questions: StudioToolQuestionPrompt[] = [];
  for (const [index, question] of rawQuestions.entries()) {
    const normalized = normalizeQuestionPrompt(question, index);
    if (normalized === undefined) {
      return {
        error: "ask_question requires every question to include text and at least one choice.",
      };
    }
    questions.push(normalized);
  }
  return { questions };
}

function normalizeQuestionPrompt(
  value: unknown,
  index: number,
): StudioToolQuestionPrompt | undefined {
  if (
    !isObject(value) ||
    typeof value.question !== "string" ||
    value.question.trim().length === 0
  ) {
    return undefined;
  }

  const choices = Array.isArray(value.choices)
    ? value.choices
        .map(normalizeQuestionChoice)
        .filter((choice): choice is StudioToolQuestionChoice => choice !== undefined)
    : [];
  if (choices.length === 0) {
    return undefined;
  }

  return {
    id:
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id.trim()
        : `question_${index + 1}`,
    question: value.question.trim(),
    choices,
  };
}

function normalizeQuestionChoice(value: unknown): StudioToolQuestionChoice | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return { label: value.trim(), value: value.trim() };
  }
  if (!isObject(value) || typeof value.label !== "string" || value.label.trim().length === 0) {
    return undefined;
  }
  return {
    label: value.label.trim(),
    value:
      typeof value.value === "string" && value.value.trim().length > 0
        ? value.value.trim()
        : value.label.trim(),
  };
}

function isPendingQuestion(
  question: PendingQuestion | StudioToolQuestion | undefined,
): question is PendingQuestion {
  return question !== undefined && question.status === "pending" && "resolve" in question;
}

function resolveQuestion(
  question: PendingQuestion | StudioToolQuestion,
  answers: StudioToolQuestionAnswer[],
): StudioToolQuestion {
  return publicQuestion({
    ...question,
    status: "answered" satisfies StudioToolQuestionStatus,
    answeredAt: new Date().toISOString(),
    answers,
  });
}

function publicQuestion(question: PendingQuestion | StudioToolQuestion): StudioToolQuestion {
  const { emit, resolve, ...rest } = question as PendingQuestion;
  void emit;
  void resolve;
  return rest;
}
