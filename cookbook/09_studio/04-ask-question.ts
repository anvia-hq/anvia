import { Agent } from "@anvia/core/agent";
import { createQuestionTool, createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const askQuestion = createQuestionTool();

const prepareEscalation = createTool({
  name: "prepare_escalation",
  description: "Create a support escalation summary from confirmed human input.",
  inputSchema: z.object({
    customer: z.string(),
    priority: z.string(),
    channel: z.string(),
    note: z.string(),
  }),
  outputSchema: z.object({
    escalationId: z.string(),
    summary: z.string(),
  }),
  execute: ({ customer, priority, channel, note }) => ({
    escalationId: "esc_1001",
    summary: `${customer} escalation via ${channel}. Priority: ${priority}. Note: ${note}`,
  }),
});

const agentModel = client.completionModel({ modelId: "gpt-5.6-luna", api: "responses" });
const agent = new Agent({
  id: "studio-human-feedback",
  model: agentModel,
  name: "Studio Human Feedback",
  description: "Collects missing operator input through Studio before acting.",
  instructions: [
    "Use ask_user when priority, channel, or operator context is missing.",
    "Ask multiple questions in one ask_user call when you need multiple answers.",
    "Use choices for bounded decisions.",
    "Set allowCustom: true when an answer outside the choices is useful; omit choices for free text.",
    "After the human answers, call prepare_escalation with the confirmed values.",
    "Keep the final answer concise.",
  ].join("\n"),
  maxTurns: 5,
  tools: [askQuestion, prepareEscalation],
});

new Studio([agent], {
  quickPrompts: {
    "studio-human-feedback": [
      "Prepare an escalation for Delta Kit Labs. Ask me for priority, channel, and any operator note.",
    ],
  },
}).start();
