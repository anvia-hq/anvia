import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const model = client.completionModel({ modelId: "gpt-5.6-luna", api: "responses" });

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  inputSchema: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  outputSchema: z.object({
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
  description: "Read an internal incident runbook excerpt.",
  inputSchema: z.object({
    name: z.string().describe("The runbook name."),
  }),
  outputSchema: z.object({
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
      "Prepare replay instructions for missed order updates.",
    ],
  }),
});

const supportAgent = new Agent({
  id: "subagent-support",
  model: model,
  name: "Support Subagent",
  description: "Summarizes customer impact from support tickets.",
  instructions: [
    "Use ticket data when available.",
    "Return customer impact, severity, and support follow-up.",
    "Do not include engineering remediation unless it is directly in the ticket.",
  ].join("\n"),
  maxTurns: 2,
  tools: [getTicket],
});

const engineeringAgent = new Agent({
  id: "subagent-engineering",
  model: model,
  name: "Engineering Subagent",
  description: "Turns runbooks and incident facts into engineering diagnostics.",
  instructions: [
    "Use runbook data when available.",
    "Return likely diagnostic checks, owner, and immediate mitigation options.",
    "Avoid customer-facing language.",
  ].join("\n"),
  maxTurns: 2,
  tools: [getRunbook],
});

const commsAgent = new Agent({
  id: "subagent-comms",
  model: model,
  name: "Comms Subagent",
  description: "Drafts concise customer updates from incident facts.",
  instructions: [
    "Draft customer-facing updates.",
    "Acknowledge impact without claiming an unverified root cause.",
    "Include the next checkpoint time when useful.",
  ].join("\n"),
});

const coordinator = new Agent({
  id: "studio-subagent-coordinator",
  model: model,
  name: "Studio Subagent Coordinator",
  description: "Delegates incident work to specialist subagents and synthesizes the result.",
  instructions: [
    "You are the coordinator visible in Studio.",
    "Delegate support impact work to ask_support_subagent.",
    "Delegate engineering diagnostics to ask_engineering_subagent.",
    "Delegate customer-facing copy to ask_comms_subagent when the user asks for communication.",
    "Combine specialist outputs into one concise operator-ready answer.",
  ].join("\n"),
  maxTurns: 4,
  tools: [
    supportAgent.asTool({ name: "ask_support_subagent", stream: true, suspension: "reject" }),
    engineeringAgent.asTool({
      name: "ask_engineering_subagent",
      stream: true,
      suspension: "reject",
    }),
    commsAgent.asTool({ name: "ask_comms_subagent", stream: true, suspension: "reject" }),
  ],
});

new Studio([coordinator], {
  quickPrompts: {
    "studio-subagent-coordinator": [
      "Prepare an incident brief for TICKET-1001 and include engineering next steps.",
      "Draft a customer update for Acme Co. about the webhook retry incident.",
      "Use the support and engineering subagents to decide the next operator action.",
    ],
  },
}).start();
