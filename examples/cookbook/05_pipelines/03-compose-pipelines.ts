import { PipelineBuilder } from "@anvia/core/pipeline";

const parseTicket = new PipelineBuilder<string>()
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

const scoreTicket = new PipelineBuilder<{ customer: string; issue: string; impact: string }>()
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

const ticketSummary = new PipelineBuilder<string>().use(parseTicket).use(scoreTicket).build();

const summary = await ticketSummary.run(
  [
    "Customer: Acme Co.",
    "Issue: webhook retries fail for payloads larger than 512 KB",
    "Impact: missed orders in the last hour",
  ].join("\n"),
);

console.log(summary);
