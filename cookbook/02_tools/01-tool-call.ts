import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

// Tools define a name, description, Zod input schema, and local implementation.
const addTool = createTool({
  name: "add",
  description: "Add two numbers together.",
  inputSchema: z.object({
    x: z.number().describe("The first number."),
    y: z.number().describe("The second number."),
  }),
  outputSchema: z.number(),
  execute: (args) => args.x + args.y,
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant. Use tools when useful.",
  maxTurns: 2,
  tools: [addTool],
});

const response = await agent.generate({ prompt: "What is 12 + 30? Use the add tool." });

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
