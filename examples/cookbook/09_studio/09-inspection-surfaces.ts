import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const tickets = new Map([
  [
    "TICKET-1001",
    {
      id: "TICKET-1001",
      customer: "Delta Kit Labs",
      status: "waiting_on_engineering" as const,
      priority: "high" as const,
      summary: "Checkout webhook retries are delayed for EU tenants.",
    },
  ],
  [
    "TICKET-1002",
    {
      id: "TICKET-1002",
      customer: "Northstar Supply",
      status: "monitoring" as const,
      priority: "medium" as const,
      summary: "Invoice export is slower than usual after a plan migration.",
    },
  ],
]);

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("Ticket id, for example TICKET-1001."),
  }),
  output: z.object({
    id: z.string(),
    customer: z.string(),
    status: z.enum(["waiting_on_engineering", "monitoring"]),
    priority: z.enum(["high", "medium"]),
    summary: z.string(),
  }),
  execute: ({ id }) => {
    const ticket = tickets.get(id);
    if (ticket === undefined) {
      throw new Error(`Unknown ticket: ${id}`);
    }
    return ticket;
  },
});

const model = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("studio-inspection-surfaces", model)
  .name("Studio Inspection Surfaces")
  .description("Demonstrates Memory, Status, tool runner, and richer agent inspection.")
  .instructions(
    [
      "Use get_ticket when the user asks about a ticket.",
      "Answer with status, priority, customer, and a short next action.",
    ].join("\n"),
  )
  .tool(getTicket)
  .defaultMaxTurns(4)
  .build();

new Studio([agent], {
  quickPrompts: {
    "studio-inspection-surfaces": [
      "Summarize TICKET-1001 and give the next support action.",
      "Check TICKET-1002 and explain what should be monitored.",
    ],
  },
}).start({ port: 4021 });

console.log("Open http://localhost:4021/ui/tools to run get_ticket directly.");
console.log("Open http://localhost:4021/ui/memory after creating a session.");
console.log("Open http://localhost:4021/ui/status for runtime counts and capabilities.");
console.log("Open http://localhost:4021/status for the raw status API response.");
