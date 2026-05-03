import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

// Tools define a name, description, Zod input schema, and local implementation.
const addTool = createTool({
  name: "add",
  description: "Add two numbers together.",
  input: z.object({
    x: z.number().describe("The first number."),
    y: z.number().describe("The second number."),
  }),
  output: z.number(),
  execute: (args) => args.x + args.y,
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("You are a concise assistant. Use tools when useful.")
  .tool(addTool)
  // Tool calls need extra turns: model asks for a tool, receives the result, then answers.
  .defaultMaxTurns(2)
  .build();

const response = await agent.prompt("What is 12 + 30? Use the add tool.").send();

console.log(response.output);
