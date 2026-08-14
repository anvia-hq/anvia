import { Extractor } from "@anvia/core/extractor";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const taskSchema = z.object({
  title: z.string().describe("A short task title."),
  priority: z.enum(["low", "medium", "high"]).describe("The task priority."),
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const model = client.completionModel("gpt-5.5");

const extractor = new Extractor({
  model,
  outputSchema: taskSchema,
  instructions: "If urgency is explicit, use high priority.",
});

const result = await extractor.extractResult("Please fix the production login issue today.", {
  retries: { maxAttempts: 2 },
});

console.log(result.data);
console.log(result.usage);
