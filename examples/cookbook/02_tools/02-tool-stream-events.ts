import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const weatherTool = createTool({
  name: "get_weather",
  description: "Get a simple local weather forecast.",
  input: z.object({
    city: z.string().describe("The city to check."),
  }),
  output: z.object({
    city: z.string(),
    forecast: z.string(),
  }),
  execute(args) {
    return {
      city: args.city,
      forecast: "Warm with light wind.",
    };
  },
});

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");

const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use the weather tool when the user asks for weather.")
  .tool(weatherTool)
  .defaultMaxTurns(2)
  .build();

// Tool streaming exposes the model request, local tool result, and final text.
for await (const event of agent.prompt("What is the weather in Jakarta?").stream()) {
  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

process.stdout.write("\n");
