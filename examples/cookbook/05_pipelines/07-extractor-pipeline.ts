import { Pipeline } from "@anvia/core/pipeline";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const ticketSchema = z.object({
  customer: z.string(),
  issue: z.string(),
  priority: z.enum(["low", "normal", "high"]),
});

const model = client.completionModel("gpt-5.5");
const ticketPipeline = new Pipeline({ id: "ticket-extraction", inputSchema: z.string() }).extract({
  id: "extract-ticket",
  model,
  outputSchema: ticketSchema,
  instructions: "Extract a support ticket from the provided operational note.",
  text: ({ input }) => `Extract a support ticket from this note:\n\n${input}`,
});

const { output: ticket } = await ticketPipeline.run({
  input: "Acme Co. reports checkout outage and missed orders after payment retries failed.",
});

console.log(ticket);
