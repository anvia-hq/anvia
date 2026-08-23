import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const mathInput = z.object({
  x: z.number(),
  y: z.number(),
});

const addTool = createTool({
  name: "add",
  description: "Add two numbers.",
  inputSchema: mathInput,
  outputSchema: z.number(),
  execute: (args) => args.x + args.y,
});

const multiplyTool = createTool({
  name: "multiply",
  description: "Multiply two numbers.",
  inputSchema: mathInput,
  outputSchema: z.number(),
  execute: (args) => args.x * args.y,
});

// Lifecycle callbacks observe each model step and tool execution.
const lifecycle = {
  onStepFinish({ step, response }) {
    console.log("step finished:", step, response.choice.length);
  },
  onToolStart({ toolName, input }) {
    console.log("tool started:", toolName, input);
  },
  onToolFinish(event) {
    console.log("tool finished:", event.toolName, event.success ? event.output : event.error);
  },
} satisfies NonNullable<ConstructorParameters<typeof Agent>[0]["lifecycle"]>;

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use tools for arithmetic and then explain the result briefly.",
  lifecycle,
  maxTurns: 2,
  tools: [addTool, multiplyTool],
});

const response = await agent.generate({
  prompt: "Calculate 3 + 9 and 7 * 6. Use both tools before answering.",
  toolConcurrency: 2,
});

if (response.type === "response") {
  console.log(response.output);
}
