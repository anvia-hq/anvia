import { Agent } from "@anvia/core/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const searchNotesTool = createTool({
  name: "search_notes",
  description: "Return mock search notes for a research topic.",
  inputSchema: z.object({
    topic: z.string(),
  }),
  outputSchema: z.array(z.string()),
  execute: ({ topic }) => [
    `${topic}: customer teams ask for clearer implementation guidance.`,
    `${topic}: support volume increased after the latest product launch.`,
    `${topic}: engineering notes mention missing examples in docs.`,
  ],
});
const sourceQualityTool = createTool({
  name: "source_quality",
  description: "Return mock source quality signals for a research topic.",
  inputSchema: z.object({
    topic: z.string(),
  }),
  outputSchema: z.object({
    confidence: z.enum(["low", "medium", "high"]),
    caveat: z.string(),
  }),
  execute: () => ({
    confidence: "medium" as const,
    caveat: "Mock data only; verify against real telemetry before making roadmap decisions.",
  }),
});

const searchNotes = new Pipeline({ id: "search-notes", inputSchema: z.string() }).step((topic) =>
  searchNotesTool.call({ topic }),
);

const sourceQuality = new Pipeline({ id: "source-quality", inputSchema: z.string() }).step(
  (topic) => sourceQualityTool.call({ topic }),
);

const synthesizerModel = client.completionModel("gpt-5.5");
const synthesizer = new Agent({
  id: "synthesizer",
  model: synthesizerModel,
  instructions: [
    "You synthesize product research notes.",
    "Separate findings, risks, and recommended next steps.",
    "Call out when evidence is mock or incomplete.",
    "Return visible final text, not only reasoning.",
  ].join("\n"),
});

const researchPipeline = new Pipeline({ id: "research", inputSchema: z.string() })
  .parallel({
    notesJson: searchNotes,
    qualityJson: sourceQuality,
  })
  .step(({ notesJson: notes, qualityJson: quality }) => {
    return [
      "Synthesize this research packet.",
      "",
      "Search notes:",
      ...notes.map((note) => `- ${note}`),
      "",
      `Confidence: ${quality.confidence}`,
      `Caveat: ${quality.caveat}`,
    ].join("\n");
  })
  .agent(synthesizer);

const report = await researchPipeline.run("Anvia pipeline cookbook examples");

console.log(report);
