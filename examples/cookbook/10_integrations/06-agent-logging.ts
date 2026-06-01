import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const logger = createPinoLogger({
  name: "anvia-cookbook",
  level: "info",
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const lookupTicket = createTool({
  name: "lookup_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The ticket id to read."),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["open", "pending", "closed"]),
    summary: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    title: "Checkout button disabled after address autocomplete",
    status: "open" as const,
    summary:
      "Users can select an address, but checkout remains disabled until they reload the page.",
  }),
});

const agent = new AgentBuilder("support-logger-demo", client.completionModel("gpt-5.5"))
  .instructions("Use tools when useful. Answer with a short engineering-focused summary.")
  .observe(
    createLoggerObserver(logger, {
      includeToolResult: true,
    }),
  )
  .tool(lookupTicket)
  .defaultMaxTurns(2)
  .build();

const response = await agent
  .prompt("Summarize ticket TICKET-1001 for the product engineering team.")
  .withTrace({
    name: "support-ticket-logging",
    userId: "cookbook-user",
    sessionId: "cookbook-session",
    metadata: { ticketId: "TICKET-1001", example: "integrations:06" },
    tags: ["cookbook", "logging"],
  })
  .send();

console.log(response.output);
