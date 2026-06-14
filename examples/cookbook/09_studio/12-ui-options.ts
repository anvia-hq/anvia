import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const getRunbook = createTool({
  name: "get_runbook",
  description: "Read a short runbook by area.",
  input: z.object({
    area: z.enum(["payments", "shipping", "incidents"]),
  }),
  output: z.object({
    area: z.string(),
    checklist: z.array(z.string()),
  }),
  execute: ({ area }) => ({
    area,
    checklist:
      area === "payments"
        ? ["Collect payment event ids", "Check retry status", "Escalate to billing-ops"]
        : area === "shipping"
          ? ["Confirm allocation", "Check carrier pickup", "Update customer timeline"]
          : ["Assign incident owner", "Open customer channel", "Set next checkpoint"],
  }),
});

const model = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("studio-custom-ui", model)
  .name("Studio Custom UI")
  .description("Demonstrates Studio UI title and root-route behavior.")
  .instructions("Use get_runbook when the user asks for an operational checklist.")
  .tool(getRunbook)
  .build();

new Studio([agent], {
  ui: {
    title: "Anvia Studio",
    rootRoutes: false,
    redirectRoot: true,
  },
  quickPrompts: {
    "studio-custom-ui": [
      "Give me the payments runbook checklist.",
      "What should I do for an incident update?",
    ],
  },
}).start({ port: 4021 });

console.log("Open http://localhost:4021/ui/playground");
console.log("Root redirects to /ui/playground, and root aliases like /playground are disabled.");
