import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const parseTicket = new PipelineBuilder(z.string())
  .step((raw) => raw.split("\n"))
  .step((lines) =>
    Object.fromEntries(lines.map((line) => line.split(":").map((part) => part.trim()))),
  )
  .step((fields) => ({
    customer: fields.Customer ?? "Unknown",
    issue: fields.Issue ?? "No issue provided",
    impact: fields.Impact ?? "No impact provided",
  }))
  .build();

const TicketInput = z.object({
  customer: z.string(),
  issue: z.string(),
  impact: z.string(),
});

const scoreTicket = new PipelineBuilder(TicketInput)
  .step((ticket) => ({
    ...ticket,
    severity:
      ticket.impact.toLowerCase().includes("missed orders") ||
      ticket.issue.toLowerCase().includes("outage")
        ? "high"
        : "normal",
  }))
  .step((ticket) => `[${ticket.severity.toUpperCase()}] ${ticket.customer}: ${ticket.issue}`)
  .build();

const ticketSummary = new PipelineBuilder(z.string()).use(parseTicket).use(scoreTicket).build();

const summary = await ticketSummary.run(
  [
    "Customer: Acme Co.",
    "Issue: webhook retries fail for payloads larger than 512 KB",
    "Impact: missed orders in the last hour",
  ].join("\n"),
);

console.log(summary);
