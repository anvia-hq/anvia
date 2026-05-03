import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const questionChoiceSchema = z.object({
  label: z.string().describe("The visible choice label."),
  value: z.string().describe("The value returned to the model if selected."),
});

const askQuestion = createTool({
  name: "ask_question",
  description: "Ask the human operator one or more follow-up questions. Always include choices.",
  input: z.object({
    questions: z.array(
      z.object({
        id: z.string().describe("Stable id for this question."),
        question: z.string().describe("The question to show to the human operator."),
        choices: z
          .array(questionChoiceSchema)
          .min(1)
          .describe("Choices to show before a custom input."),
      }),
    ),
  }),
  output: z.object({
    answers: z.array(
      z.object({
        questionId: z.string(),
        answer: z.string(),
        choice: z.string().optional(),
        custom: z.boolean().optional(),
      }),
    ),
  }),
  async execute({ questions }) {
    return {
      answers: questions.map((question) => ({
        questionId: question.id,
        answer: "No human answer was provided by this runtime.",
      })),
    };
  },
});

const prepareEscalation = createTool({
  name: "prepare_escalation",
  description: "Create a support escalation summary from confirmed human input.",
  input: z.object({
    customer: z.string(),
    priority: z.string(),
    channel: z.string(),
    note: z.string(),
  }),
  output: z.object({
    escalationId: z.string(),
    summary: z.string(),
  }),
  execute: ({ customer, priority, channel, note }) => ({
    escalationId: "esc_1001",
    summary: `${customer} escalation via ${channel}. Priority: ${priority}. Note: ${note}`,
  }),
});

const agentModel = client.completionModel("z-ai/glm-5.1");
const agent = new AgentBuilder("studio-human-feedback", agentModel)
  .name("Studio Human Feedback")
  .description("Collects missing operator input through Studio before acting.")
  .instructions(
    [
      "Use ask_question when priority, channel, or operator context is missing.",
      "Ask multiple questions in one ask_question call when you need multiple answers.",
      "Use choices for bounded decisions.",
      "Studio always shows a custom input after the choices.",
      "After the human answers, call prepare_escalation with the confirmed values.",
      "Keep the final answer concise.",
    ].join("\n"),
  )
  .tools([askQuestion, prepareEscalation])
  .defaultMaxTurns(5)
  .build();

new Studio([agent], {
  quickPrompts: {
    "studio-human-feedback": [
      "Prepare an escalation for Delta Kit Labs. Ask me for priority, channel, and any operator note.",
    ],
  },
}).start();
