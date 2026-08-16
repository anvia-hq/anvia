import { Agent } from "@anvia/core/agent";
import { createThinkTool, createTool } from "@anvia/core/tool";
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

const thinkTool = createThinkTool();

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");

// The think tool gives models an explicit scratchpad step before final answers.
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use the think tool before answering multi-step questions.",
  maxTurns: 3,
  tools: [thinkTool, addTool],
});

for await (const event of agent.stream({
  prompt: "Think through the steps, then calculate 17 + 25 and answer briefly.",
})) {
  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.toolName, event.toolCall.input);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.toolName, event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

process.stdout.write("\n");
