import { z } from "zod";
import type { AgentQuestionAnswer, AgentQuestionPrompt } from "../agent/interactions";
import { createTool } from "./create-tool";
import type { Tool } from "./tool";

const questionToolMarker = Symbol("anvia.question-tool");

export const DEFAULT_QUESTION_TOOL_NAME = "ask_user";

export const DEFAULT_QUESTION_TOOL_DESCRIPTION = `Ask the user questions and wait for their answers before continuing.

Use this tool only when you cannot continue without the user's input:
- The request is ambiguous, and different readings would lead to clearly different results.
- A decision belongs to the user: a preference, a tradeoff, or something that is hard to undo.
- Information you need is missing and you cannot find it with your other tools or work it out from the conversation.

Do not use it:
- For facts you can look up with your other tools, or work out from the conversation.
- To ask permission for routine steps the user has already asked for.
- To check whether your answer or plan is good. Finish the work and let the user react.
- For choices with a sensible default. Pick it, and mention the choice in your reply.

How to ask:
- Put every question you need into one call instead of calling the tool repeatedly. Ask no more than 4 questions per call.
- Give each question a short, unique \`id\` in snake_case.
- Write \`text\` as one complete, self-contained question that ends with a question mark.
- When there is a known set of reasonable answers, give 2–4 \`choices\` with a short \`label\` and a stable \`value\`. Make the choices mutually exclusive. If you recommend one, list it first and add " (recommended)" to its label.
- Set \`allowCustom: true\` when the user might want an answer outside the list. Leave out \`choices\` for open-ended questions. Do not add an "Other" choice.

After you get the answers:
- Each answer has a \`questionId\` and a \`value\` (the chosen value or the user's free text).
- Follow the answers. Do not ask the same question again unless an answer is unclear or contradicts another one.`;

export type QuestionToolInput = {
  questions: readonly AgentQuestionPrompt[];
};

export type QuestionToolOutput = {
  answers: readonly AgentQuestionAnswer[];
};

export type CreateQuestionToolOptions = {
  /** Defaults when omitted. Supply a nonblank name; explicit strings are preserved. */
  name?: string;
  /** Defaults when omitted. Supply nonblank instructions; explicit strings are preserved. */
  description?: string;
};

type MarkedQuestionTool = Tool<QuestionToolInput, QuestionToolOutput> & {
  readonly [questionToolMarker]: true;
};

export function createQuestionTool(
  options: CreateQuestionToolOptions = {},
): Tool<QuestionToolInput, QuestionToolOutput> {
  const tool = createTool({
    name: options.name ?? DEFAULT_QUESTION_TOOL_NAME,
    description: options.description ?? DEFAULT_QUESTION_TOOL_DESCRIPTION,
    inputSchema: z
      .object({
        questions: z
          .array(
            z
              .object({
                id: z.string().trim().min(1, "Question IDs must not be empty."),
                text: z.string().trim().min(1, "Question text must not be empty."),
                choices: z
                  .array(
                    z
                      .object({
                        label: z
                          .string()
                          .trim()
                          .min(1, "Question choice labels must not be empty."),
                        value: z
                          .string()
                          .trim()
                          .min(1, "Question choice values must not be empty."),
                      })
                      .strict(),
                  )
                  .min(2, "Questions with choices must have at least 2 choices.")
                  .max(4, "Questions must have no more than 4 choices.")
                  .superRefine((choices, context) => {
                    const values = new Set<string>();
                    for (const [index, choice] of choices.entries()) {
                      if (values.has(choice.value)) {
                        context.addIssue({
                          code: "custom",
                          message: "Question choice values must be unique.",
                          path: [index, "value"],
                        });
                      }
                      values.add(choice.value);
                    }
                  })
                  .optional(),
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
              }),
          )
          .min(1, "Provide at least 1 question.")
          .max(4, "Ask no more than 4 questions per call.")
          .superRefine((questions, context) => {
            const ids = new Set<string>();
            for (const [index, question] of questions.entries()) {
              if (ids.has(question.id)) {
                context.addIssue({
                  code: "custom",
                  message: "Question IDs must be unique.",
                  path: [index, "id"],
                });
              }
              ids.add(question.id);
            }
          }),
      })
      .strict(),
    execute(): never {
      throw new Error("Question tools can only be resolved through an Agent interaction.");
    },
  }) as unknown as MarkedQuestionTool;
  Object.defineProperty(tool, questionToolMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return tool;
}

export function isQuestionTool(tool: unknown): tool is Tool<QuestionToolInput, QuestionToolOutput> {
  return typeof tool === "object" && tool !== null && questionToolMarker in tool;
}
