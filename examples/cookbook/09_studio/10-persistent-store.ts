import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AgentBuilder } from "@anvia/core/agent";
import { PipelineBuilder } from "@anvia/core/pipeline";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { createSqliteSessionStore, Studio } from "@anvia/studio";
import { z } from "zod";

const dbPath = process.env.ANVIA_STUDIO_DB ?? ".anvia-studio/cookbook-studio.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

const store = createSqliteSessionStore({ path: dbPath });

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const getEscalation = createTool({
  name: "get_escalation",
  description: "Read the current escalation owner for an operational area.",
  input: z.object({
    area: z
      .string()
      .optional()
      .describe("Operational area, such as billing, fulfillment, webhooks, payments, or shipping."),
  }),
  output: z.object({
    area: z.string(),
    owner: z.string(),
    nextAction: z.string(),
  }),
  execute: ({ area }) => {
    const normalizedArea = escalationArea(area ?? "webhooks");
    return {
      area: normalizedArea,
      owner:
        normalizedArea === "billing"
          ? "billing-ops"
          : normalizedArea === "fulfillment"
            ? "warehouse-ops"
            : "platform",
      nextAction:
        normalizedArea === "billing"
          ? "Attach payment event ids to the handoff."
          : normalizedArea === "fulfillment"
            ? "Confirm allocation before promising shipment timing."
            : "Include retry queue depth and recent deploy ids.",
    };
  },
});

const model = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("studio-persistent-ops", model)
  .name("Studio Persistent Ops")
  .description("Demonstrates persisted Studio sessions, traces, pipeline logs, and run history.")
  .instructions("Use get_escalation when the user asks who owns an operational follow-up.")
  .tool(getEscalation)
  .defaultMaxTurns(4)
  .build();

const escalationPipeline = new PipelineBuilder<string>({
  id: "persistent-escalation-pipeline",
  name: "Persistent Escalation Pipeline",
  description: "Creates pipeline logs and replayable run history in the same SQLite store.",
})
  .step((area) => area.trim().toLowerCase(), {
    name: "Normalize Area",
  })
  .step((area) => ({
    area,
    severity: area.includes("webhook") ? "high" : "normal",
    owner: area.includes("billing")
      ? "billing-ops"
      : area.includes("fulfillment")
        ? "warehouse-ops"
        : "platform",
  }))
  .build();

new Studio([agent, escalationPipeline], {
  stores: {
    sessions: store,
    traces: store,
    pipelineLogs: store,
    pipelineRuns: store,
  },
  quickPrompts: {
    "studio-persistent-ops": [
      "Who owns the webhook escalation and what context should I include?",
      "Who owns a fulfillment allocation issue?",
    ],
  },
}).start({ port: 4021 });

console.log(`Studio state is persisted in ${dbPath}`);
console.log("Open http://localhost:4021/ui/playground and create a session.");
console.log("Restart this example, then open /ui/sessions, /ui/tracing, and /ui/pipelines.");

function escalationArea(area: string): "billing" | "fulfillment" | "webhooks" {
  const normalized = area.toLowerCase();
  if (
    normalized.includes("billing") ||
    normalized.includes("payment") ||
    normalized.includes("invoice")
  ) {
    return "billing";
  }
  if (
    normalized.includes("fulfillment") ||
    normalized.includes("shipping") ||
    normalized.includes("warehouse") ||
    normalized.includes("allocation")
  ) {
    return "fulfillment";
  }
  return "webhooks";
}
