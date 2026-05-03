import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { otel } from "@anvia/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { z } from "zod";

const exporterOptions =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined
    ? {}
    : { url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT };

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(exporterOptions),
});

sdk.start();

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const tracing = otel.create({
  serviceName: "anvia-cookbook",
});

const getTicket = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  input: z.object({
    id: z.string().describe("The ticket id to read."),
  }),
  output: z.object({
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

const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use tools when useful. Answer with a short engineering-focused summary.")
  .observe(tracing)
  .tools([getTicket])
  .defaultMaxTurns(2)
  .build();

try {
  const response = await agent
    .prompt("Summarize ticket TICKET-1001 for the product engineering team.")
    .withTrace({
      name: "support-ticket-summary",
      userId: "cookbook-user",
      sessionId: "cookbook-session",
      metadata: { ticketId: "TICKET-1001", example: "integrations:05" },
      tags: ["cookbook", "anvia"],
    })
    .send();

  console.log(response.output);
  console.log("trace:", response.trace?.traceId ?? "(not available)");
} finally {
  await sdk.shutdown();
}
