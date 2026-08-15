import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

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

const enableMathTools = process.env.ENABLE_MATH_TOOLS !== "false";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agent = new Agent({
  id: "agent",
  model: client.completionModel("gpt-5.5"),
  instructions: "You are a concise assistant. Use tools only when they are available.",
  maxTurns: 2,
  tools: enableMathTools ? [addTool] : [],
});
const prompt = enableMathTools
  ? "What is 18 + 24? Use the add tool."
  : "Are arithmetic tools available in this run?";

const response = await agent.generate({ prompt });

if (response.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log("math tools enabled:", enableMathTools);
console.log(response.output);
