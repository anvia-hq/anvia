import { Agent } from "@anvia/core/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const analystModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const analyst = new Agent({
  id: "analyst",
  model: analystModel,
  instructions: [
    "You turn rough operational notes into a concise executive update.",
    "Use only the facts provided.",
    "Return visible final text, not only reasoning.",
    "Use compact bullets.",
  ].join("\n"),
});

const executiveUpdate = new Pipeline({
  id: "executive-update",
  inputSchema: z.array(z.string()),
})
  .step({
    id: "format-notes",
    run: ({ input }) => input.map((note) => `- ${note}`).join("\n"),
  })
  .agent({
    id: "analyze",
    agent: analyst,
    approval: "reject",
    request: ({ input }) => ({
      prompt: `Prepare an executive update from these notes:\n\n${input}`,
    }),
  });

const { output } = await executiveUpdate.run({
  input: [
    "Acme Co. missed several webhook retries in the last hour.",
    "Failures only affect payloads larger than 512 KB.",
    "Engineering is checking retry queue limits and delivery logs.",
  ],
});

console.log(output);
