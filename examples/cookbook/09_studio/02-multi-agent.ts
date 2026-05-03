import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  output: z.object({
    id: z.string(),
    customer: z.string(),
    priority: z.enum(["low", "medium", "high"]),
    status: z.string(),
    summary: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    customer: "Acme Co.",
    priority: "high" as const,
    status: "waiting_on_engineering",
    summary: "Webhook retries fail when payloads are larger than 512 KB.",
  }),
});

const getRunbook = createTool({
  name: "get_runbook",
  description: "Read an internal runbook excerpt.",
  input: z.object({
    name: z.string().describe("The runbook name."),
  }),
  output: z.object({
    name: z.string(),
    owner: z.string(),
    checklist: z.array(z.string()),
  }),
  execute: ({ name }) => ({
    name,
    owner: "Platform Engineering",
    checklist: [
      "Check retry queue depth.",
      "Inspect payload-size rejection logs.",
      "Confirm whether retries are being dropped or delayed.",
    ],
  }),
});

const supportAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const supportAgent = new AgentBuilder("support-triage", supportAgentModel)
  .name("Support Triage")
  .description("Summarizes customer-facing support tickets.")
  .instructions("Use private ticket data. Keep support summaries concise and action-oriented.")
  .tool(getTicket)
  .defaultMaxTurns(2)
  .build();

const engineeringAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const engineeringAgent = new AgentBuilder("engineering-triage", engineeringAgentModel)
  .name("Engineering Triage")
  .description("Turns incidents and runbooks into engineering next steps.")
  .instructions("Use runbooks for operational questions. Return concrete diagnostics and owners.")
  .tool(getRunbook)
  .defaultMaxTurns(2)
  .build();

const commsAgentModel = client.completionModel("deepseek/deepseek-v4-pro");
const commsAgent = new AgentBuilder("customer-comms", commsAgentModel)
  .name("Customer Comms")
  .description("Drafts concise customer updates for incidents.")
  .instructions("Draft customer updates without unverified root-cause claims.")
  .build();

new Studio([supportAgent, engineeringAgent, commsAgent], {
  quickPrompts: {
    "support-triage": ["Summarize TICKET-1001 for the support lead."],
    "engineering-triage": ["Use the webhook retries runbook to prepare diagnostics."],
    "customer-comms": ["Draft a customer update for a webhook retry incident."],
  },
}).start();
