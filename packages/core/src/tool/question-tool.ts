import { z } from "zod";
import type { AgentQuestionAnswer, AgentQuestionPrompt } from "../agent/interactions";
import { createTool } from "./create-tool";
import type { Tool } from "./tool";

const questionToolMarker = Symbol("anvia.question-tool");

export type QuestionToolInput = {
  questions: readonly AgentQuestionPrompt[];
};

export type QuestionToolOutput = {
  answers: readonly AgentQuestionAnswer[];
};

export type CreateQuestionToolOptions = {
  name: string;
  description: string;
};

type MarkedQuestionTool = Tool<QuestionToolInput, QuestionToolOutput> & {
  readonly [questionToolMarker]: true;
};

export function createQuestionTool(
  options: CreateQuestionToolOptions,
): Tool<QuestionToolInput, QuestionToolOutput> {
  const tool = createTool({
    name: options.name,
    description: options.description,
    inputSchema: z
      .object({
        questions: z
          .array(
            z
              .object({
                id: z.string().trim().min(1),
                text: z.string().trim().min(1),
                choices: z
                  .array(
                    z
                      .object({
                        label: z.string().trim().min(1),
                        value: z.string().trim().min(1),
                      })
                      .strict(),
                  )
                  .min(1)
                  .optional(),
                allowCustom: z.boolean().optional(),
              })
              .strict(),
          )
          .min(1),
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
