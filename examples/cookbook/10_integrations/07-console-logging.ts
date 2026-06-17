import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { createConsoleLogger, createLoggerObserver } from "@anvia/logger";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const logger = createConsoleLogger({
  name: "anvia-cookbook",
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  bindings: { example: "integrations:07" },
});

logger.child({ component: "setup" }).info("console logger configured");

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
    title: "Search indexing delay after content publish",
    status: "pending" as const,
    summary: "New articles are visible in the CMS but missing from the customer search index.",
  }),
});

const agent = new AgentBuilder("support-console-logger-demo", client.completionModel("gpt-5.5"))
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
  .prompt("Summarize ticket TICKET-2002 for the search team.")
  .withTrace({
    name: "support-ticket-console-logging",
    userId: "cookbook-user",
    sessionId: "cookbook-session",
    metadata: { ticketId: "TICKET-2002", example: "integrations:07" },
    tags: ["cookbook", "logging"],
  })
  .send();

console.log(response.output);
