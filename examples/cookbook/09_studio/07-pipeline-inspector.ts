import { AgentBuilder } from "@anvia/core/agent";
import { PipelineBuilder } from "@anvia/core/pipeline";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const replyModel = client.completionModel("deepseek/deepseek-v4-pro");
const replyAgent = new AgentBuilder("studio-reply-drafter", replyModel)
  .name("Studio Reply Drafter")
  .description("Drafts short support replies from normalized ticket context.")
  .instructions(
    [
      "Draft concise customer support replies.",
      "Use only the ticket context provided by the pipeline.",
      "Mention the priority and the next operational step.",
    ].join("\n"),
  )
  .build();

const ticketPipeline = new PipelineBuilder<string>({
  id: "ticket-triage-pipeline",
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
      classification: new PipelineBuilder<string>()
        .step((ticket) => ({
          topic: ticket.toLowerCase().includes("payment") ? "billing" : "operations",
        }))
        .build(),
      priority: new PipelineBuilder<string>()
        .step((ticket) => ({
          priority:
            ticket.toLowerCase().includes("outage") || ticket.toLowerCase().includes("enterprise")
              ? "high"
              : "normal",
        }))
        .build(),
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
  .prompt(replyAgent, {
    name: "Draft Reply",
    description: "Send the prepared context to the reply agent.",
  })
  .build();

new Studio([replyAgent, ticketPipeline]).start();
