import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { langfuse } from "@anvia/langfuse";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const tracing = langfuse.create({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
  environment: process.env.LANGFUSE_TRACING_ENVIRONMENT,
  release: process.env.LANGFUSE_RELEASE,
});

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  inputSchema: z.object({
    id: z.string().describe("The ticket id to read."),
  }),
  outputSchema: z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    title: "Checkout button disabled after address autocomplete",
    severity: "high" as const,
    summary:
      "Users can select an address, but checkout remains disabled until they reload the page.",
  }),
});

const agentModel = client.completionModel("gpt-5.5");
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use tools when useful. Answer with a short engineering-focused summary.",
  maxTurns: 2,
  tools: [getTicket],
  observers: [tracing],
});

try {
  const response = await agent.generate({
    prompt: "Summarize ticket TICKET-1001 for the product engineering team.",
    trace: {
      name: "support-ticket-summary",
      userId: "cookbook-user",
      sessionId: "cookbook-session",
      metadata: { ticketId: "TICKET-1001", example: "integrations:03" },
      tags: ["cookbook", "anvia"],
    },
  });

  if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
  console.log(response.output);
  console.log("trace:", response.trace?.traceId ?? "(not available)");
} finally {
  await tracing.shutdown();
}
