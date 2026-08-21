import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const parseTicket = new Pipeline({ id: "parse-ticket", inputSchema: z.string() })
  .step({ id: "split-lines", run: ({ input }) => input.split("\n") })
  .step({
    id: "parse-fields",
    run: ({ input }) =>
      Object.fromEntries(input.map((line) => line.split(":").map((part) => part.trim()))),
  })
  .step({
    id: "shape-ticket",
    run: ({ input: fields }) => ({
      customer: fields.Customer ?? "Unknown",
      issue: fields.Issue ?? "No issue provided",
      impact: fields.Impact ?? "No impact provided",
    }),
  });

const TicketInput = z.object({
  customer: z.string(),
  issue: z.string(),
  impact: z.string(),
});

const scoreTicket = new Pipeline({ id: "score-ticket", inputSchema: TicketInput })
  .step({
    id: "score-severity",
    run: ({ input: ticket }) => ({
      ...ticket,
      severity:
        ticket.impact.toLowerCase().includes("missed orders") ||
        ticket.issue.toLowerCase().includes("outage")
          ? "high"
          : "normal",
    }),
  })
  .step({
    id: "format-summary",
    run: ({ input: ticket }) =>
      `[${ticket.severity.toUpperCase()}] ${ticket.customer}: ${ticket.issue}`,
  });

const ticketSummary = new Pipeline({ id: "ticket-summary", inputSchema: z.string() })
  .compose({ id: "parse", pipeline: parseTicket })
  .compose({ id: "score", pipeline: scoreTicket });

const { output: summary } = await ticketSummary.run({
  input: [
    "Customer: Acme Co.",
    "Issue: webhook retries fail for payloads larger than 512 KB",
    "Impact: missed orders in the last hour",
  ].join("\n"),
});

console.log(summary);
