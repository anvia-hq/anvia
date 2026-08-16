import { Agent } from "@anvia/core/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const incident = [
  "Customer: Acme Co.",
  "Issue: webhook retries fail when payloads are larger than 512 KB.",
  "Impact: several order updates were missed in the last hour.",
  "Constraint: do not claim a root cause until engineering verifies it.",
].join("\n");

const model = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const supportAgent = new Agent({
  id: "support",
  model: model,
  name: "Support Specialist",
  instructions: [
    "Summarize customer impact, support priority, and the next support reply using only provided facts.",
    "Return visible final text, not only reasoning.",
  ].join("\n"),
});

const engineeringAgent = new Agent({
  id: "engineering",
  model: model,
  name: "Engineering Specialist",
  instructions: [
    "Identify likely diagnostics, owner, and safest technical next step using only provided facts.",
    "Return visible final text, not only reasoning.",
  ].join("\n"),
});

const commsAgent = new Agent({
  id: "comms",
  model: model,
  name: "Customer Comms Specialist",
  instructions: [
    "Draft a short customer-facing update without unverified root-cause claims.",
    "Return visible final text, not only reasoning.",
  ].join("\n"),
});

const synthesizerAgent = new Agent({
  id: "synthesizer",
  model: model,
  name: "Incident Synthesizer",
  instructions: [
    "Merge specialist notes into one operational incident brief.",
    "Keep the brief concise.",
    "Include customer impact, engineering next step, support next step, and customer update.",
    "Use plain text bullets, no tables, and no emoji.",
  ].join("\n"),
});

const supportNotesPipeline = new Pipeline({ id: "support-notes", inputSchema: z.string() }).agent({
  id: "support",
  agent: supportAgent,
  approval: "reject",
  request: ({ input }) => ({ prompt: `Triage this incident for support:\n\n${input}` }),
});

const engineeringNotesPipeline = new Pipeline({
  id: "engineering-notes",
  inputSchema: z.string(),
}).agent({
  id: "engineering",
  agent: engineeringAgent,
  approval: "reject",
  request: ({ input }) => ({ prompt: `Triage this incident for engineering:\n\n${input}` }),
});

const commsNotesPipeline = new Pipeline({ id: "comms-notes", inputSchema: z.string() }).agent({
  id: "comms",
  agent: commsAgent,
  approval: "reject",
  request: ({ input }) => ({
    prompt: `Draft customer communication for this incident:\n\n${input}`,
  }),
});

const incidentBrief = new Pipeline({ id: "incident-brief", inputSchema: z.string() })
  .parallel({
    id: "specialists",
    branches: {
      support: supportNotesPipeline,
      engineering: engineeringNotesPipeline,
      comms: commsNotesPipeline,
    },
  })
  .agent({
    id: "synthesize",
    agent: synthesizerAgent,
    approval: "reject",
    request: ({ input: { support, engineering, comms } }) => {
      const supportNotes = visibleText(
        support,
        "Support should treat this as high priority, acknowledge missed order updates, and collect retry failure examples.",
      );
      const engineeringNotes = visibleText(
        engineering,
        "Engineering should inspect retry payload-size handling, queue limits, and outbound delivery logs.",
      );
      const commsNotes = visibleText(
        comms,
        "We are investigating missed webhook retries for larger payloads and will provide the next update after diagnostics.",
      );

      console.log("support specialist:\n", supportNotes);
      console.log("engineering specialist:\n", engineeringNotes);
      console.log("comms specialist:\n", commsNotes);

      return {
        prompt: [
          "Synthesize these specialist notes.",
          "",
          `Incident:\n${incident}`,
          "",
          `Support notes:\n${supportNotes}`,
          "",
          `Engineering notes:\n${engineeringNotes}`,
          "",
          `Customer comms notes:\n${commsNotes}`,
        ].join("\n"),
      };
    },
  });

const { output: final } = await incidentBrief.run({ input: incident });

console.log("final brief:\n", visibleText(final, "No visible synthesis text was returned."));

function visibleText(output: string, fallback: string): string {
  const trimmed = output.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}
