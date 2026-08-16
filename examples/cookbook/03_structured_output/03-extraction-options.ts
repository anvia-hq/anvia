import { extract } from "@anvia/core/extractor";
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

const result = await extract({
  model,
  text: "Please fix the production login issue today.",
  outputSchema: taskSchema,
  instructions: "If urgency is explicit, use high priority.",
  retries: { maxAttempts: 2 },
});

console.log(result.output);
console.log(result.usage);
