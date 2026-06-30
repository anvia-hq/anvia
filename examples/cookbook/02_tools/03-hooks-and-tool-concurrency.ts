import { AgentBuilder } from "@anvia/core/agent";
import { createHook } from "@anvia/core/hooks";
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
  input: mathInput,
  output: z.number(),
  execute: (args) => args.x + args.y,
});

const multiplyTool = createTool({
  name: "multiply",
  description: "Multiply two numbers.",
  input: mathInput,
  output: z.number(),
  execute: (args) => args.x * args.y,
});

// Hooks observe or control each completion/tool step.
const hook = createHook({
  onCompletionCall({ prompt }) {
    console.log("completion call:", prompt.role);
  },
  onToolCall({ toolName, args }) {
    console.log("tool call:", toolName, args);
  },
  onToolResult({ toolName, result }) {
    console.log("tool result:", toolName, result);
  },
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use tools for arithmetic and then explain the result briefly.")
  .tools([addTool, multiplyTool])
  .hook(hook)
  .defaultMaxTurns(2)
  .build();

const response = await agent
  .prompt("Calculate 3 + 9 and 7 * 6. Use both tools before answering.")
  // Independent tool calls can run concurrently.
  .withToolConcurrency(2)
  .send();

console.log(response.output);
