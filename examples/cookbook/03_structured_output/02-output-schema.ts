import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

// outputSchema asks the model to answer with data matching this schema.
const summarySchema = z
  .object({
    title: z.string(),
    bullets: z.array(z.string()).min(2).max(4),
  })
  .meta({ title: "summary_response" });

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("Return only data that matches the requested schema.")
  .outputSchema(summarySchema)
  .build();

const response = await agent
  .prompt("Summarize why tool calling is useful for agent frameworks.")
  .send();

console.log(response.output);
