import { ExtractorBuilder } from "@anvia/core/extractor";
import { PipelineBuilder } from "@anvia/core/pipeline";
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
const ticketExtractor = new ExtractorBuilder(model, ticketSchema)
  .instructions("Extract a support ticket from the provided operational note.")
  .build();

const ticketPipeline = new PipelineBuilder(z.string())
  .step((note) => `Extract a support ticket from this note:\n\n${note}`)
  .extract(ticketExtractor)
  .build();

const ticket = await ticketPipeline.run(
  "Acme Co. reports checkout outage and missed orders after payment retries failed.",
);

console.log(ticket);
