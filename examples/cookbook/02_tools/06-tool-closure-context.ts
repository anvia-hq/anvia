import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const tickets = new Map([
  [
    "TICKET-1001",
    {
      id: "TICKET-1001",
      customer: "Acme Co.",
      priority: "high",
      status: "waiting_on_engineering",
      summary: "Webhook retries fail when payloads are larger than 512 KB.",
    },
  ],
  [
    "TICKET-1002",
    {
      id: "TICKET-1002",
      customer: "Northstar Labs",
      priority: "medium",
      status: "open",
      summary: "Dashboard export includes stale cached totals.",
    },
  ],
]);

// Tools can close over application state without exposing it to the model directly.
const getTicketTool = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  output: z.object({
    id: z.string(),
    customer: z.string(),
    priority: z.string(),
    status: z.string(),
    summary: z.string(),
  }),
  execute({ id }) {
    const ticket = tickets.get(id);
    if (ticket === undefined) {
      throw new Error(`Ticket not found: ${id}`);
    }
    return ticket;
  },
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use local tools when the user asks about private support tickets.")
  .tool(getTicketTool)
  .defaultMaxTurns(2)
  .build();

for await (const event of agent.prompt("Summarize TICKET-1001 for a product engineer.").stream()) {
  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

process.stdout.write("\n");
