import { Agent } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { createOtelEvalReporter, otel } from "@anvia/otel";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { z } from "zod";

const exporterOptions =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined
    ? {}
    : { url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT };
const logExporterOptions =
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT === undefined
    ? {}
    : { url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT };

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(exporterOptions),
  logRecordProcessors: [
    new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(logExporterOptions) }),
  ],
});

sdk.start();

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const tracing = otel.create({
  serviceName: "anvia-cookbook",
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
  const response = await agent.generate(
    "Summarize ticket TICKET-1001 for the product engineering team.",
    {
      trace: {
        name: "support-ticket-summary",
        userId: "cookbook-user",
        sessionId: "cookbook-session",
        metadata: { ticketId: "TICKET-1001", example: "integrations:05" },
        tags: ["cookbook", "anvia"],
      },
    },
  );

  if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
  console.log(response.output);
  console.log("trace:", response.trace?.traceId ?? "(not available)");

  const evalResult = await runEvalSuite({
    name: "support-ticket-regression",
    cases: [
      {
        id: "checkout-summary",
        input: "Summarize ticket TICKET-1001 for the product engineering team.",
        expected: /checkout/i,
      },
    ],
    target: agentEvalTarget(agent),
    metrics: [contains()],
    reporters: [createOtelEvalReporter({ onMissingTrace: "warn" })],
  });

  console.log("eval:", evalResult.results[0]?.metrics[0]?.outcome);
} finally {
  await sdk.shutdown();
}
