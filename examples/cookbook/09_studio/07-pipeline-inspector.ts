import { Agent } from "@anvia/core/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const replyModel = client.completionModel("gpt-5.6-luna");
const replyAgent = new Agent({
  id: "studio-reply-drafter",
  model: replyModel,
  name: "Studio Reply Drafter",
  description: "Drafts short support replies from normalized ticket context.",
  instructions: [
    "Draft concise customer support replies.",
    "Use only the ticket context provided by the pipeline.",
    "Mention the priority and the next operational step.",
  ].join("\n"),
});

const ticketPipeline = new Pipeline({
  id: "ticket-triage-pipeline",
  inputSchema: z.string(),
  name: "Ticket Triage Pipeline",
  description: "Normalizes a ticket, computes metadata, then drafts a reply.",
  metadata: {
    owner: "support-operations",
  },
})
  .step((ticket) => ticket.trim(), {
    name: "Normalize Ticket",
    description: "Trim pasted ticket text before branching.",
  })
  .parallel(
    {
      classification: new Pipeline({
        id: "ticket-classification",
        inputSchema: z.string(),
      }).step((ticket) => ({
        topic: ticket.toLowerCase().includes("payment") ? "billing" : "operations",
      })),
      priority: new Pipeline({ id: "ticket-priority", inputSchema: z.string() }).step((ticket) => ({
        priority:
          ticket.toLowerCase().includes("outage") || ticket.toLowerCase().includes("enterprise")
            ? "high"
            : "normal",
      })),
    },
    {
      name: "Analyze Ticket",
      description: "Run deterministic branch checks for Studio graph inspection.",
    },
  )
  .step(
    ({ classification, priority }) =>
      [
        `Topic: ${classification.topic}`,
        `Priority: ${priority.priority}`,
        "Ticket: Enterprise customer reports payment retries causing checkout outage.",
      ].join("\n"),
    {
      name: "Prepare Reply Prompt",
    },
  )
  .agent(replyAgent, {
    name: "Draft Reply",
    description: "Send the prepared context to the reply agent.",
  });

new Studio([replyAgent, ticketPipeline]).start();
