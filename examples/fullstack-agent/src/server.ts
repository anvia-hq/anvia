import { AgentBuilder, createTool, type UIStreamRequest } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createEventStream } from "@anvia/server";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const getOrder = createTool({
  name: "get_order",
  description: "Read an order summary from local application state.",
  input: z.object({
    id: z.string().describe("The order id to read."),
  }),
  output: z.object({
    id: z.string(),
    status: z.enum(["processing", "blocked", "shipped"]),
    customer: z.string(),
    notes: z.string(),
  }),
  execute: ({ id }) => ({
    id,
    status: "blocked" as const,
    customer: "Delta Kit Labs",
    notes: "Payment review is complete, but warehouse allocation has not been confirmed.",
  }),
});

const agentModel = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("support-operations", agentModel)
  .name("Support Operations")
  .description("Answers operational questions with short, concrete summaries.")
  .instructions("Use tools when useful. Keep answers concise and action-oriented.")
  .tool(getOrder)
  .defaultMaxTurns(50)
  .build();

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/chat", async (c) => {
  const body = (await c.req.json()) as UIStreamRequest;

  return createEventStream(agent.prompt(body.messages).stream(), {
    format: "jsonl",
  });
});

export function startApiServer(port = 8787) {
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port,
  });

  console.log(`Hono API listening on http://127.0.0.1:${port}`);
  return server;
}
