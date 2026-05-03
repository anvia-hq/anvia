import { Message } from "@anvia/core/completion";
import { ExtractorBuilder } from "@anvia/core/extractor";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const taskSchema = z.object({
  title: z.string().describe("A short task title."),
  priority: z.enum(["low", "medium", "high"]).describe("The task priority."),
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const model = client.completionModel("deepseek/deepseek-v4-pro");

// This extends basic extraction with context, retries, and prior messages.
const extractor = new ExtractorBuilder(model, taskSchema)
  .context("If urgency is explicit, use high priority.")
  .retries(1)
  .build();

const response = await extractor.extractWithHistory(
  "Please fix the production login issue today.",
  [Message.user("We are triaging engineering work.")],
);

console.log(response);
