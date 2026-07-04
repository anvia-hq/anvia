import { createCompletionStream, type UIStreamRequest } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createEventStream } from "@anvia/server";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5.5");
const instructions = [
  "You are Support Operations. Answer operational questions with short, concrete summaries.",
  "Use this local application context when it is relevant: order A-100 belongs to Delta Kit Labs, its status is blocked, and payment review is complete, but warehouse allocation has not been confirmed.",
  "Keep answers concise and action-oriented.",
].join("\n\n");

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/completion", async (c) => {
  const body = (await c.req.json()) as UIStreamRequest;

  return createEventStream(
    createCompletionStream(model, {
      messages: body.messages,
      instructions,
    }),
    {
      format: "jsonl",
    },
  );
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
