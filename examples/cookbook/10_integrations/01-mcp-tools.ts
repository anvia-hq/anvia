import { AgentBuilder } from "@anvia/core/agent";
import { connectMcp, mcp } from "@anvia/core/mcp";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const counterMcp = await connectMcp(
  mcp.stdio({
    name: "counter",
    command: "tsx",
    args: ["10_integrations/_support/mcp-counter-server.ts"],
  }),
);

try {
  const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
  const agent = new AgentBuilder("agent", agentModel)
    .instructions("Use MCP tools for arithmetic and counter updates.")
    .mcp([counterMcp])
    .defaultMaxTurns(3)
    .build();

  for await (const event of agent
    .prompt("Add 8 and 13, then increment the counter by the result.")
    .stream()) {
    if (event.type === "tool_call") {
      console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
    }

    if (event.type === "tool_result") {
      console.log("tool result:", event.toolName, event.result);
    }

    if (event.type === "final") {
      console.log("final:", event.output);
    }
  }
} finally {
  await counterMcp.close();
}
