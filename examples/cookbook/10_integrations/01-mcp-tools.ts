import { Agent } from "@anvia/core/agent";
import { McpClient } from "@anvia/core/mcp";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const counterMcp = new McpClient({
  name: "counter",
  transport: {
    type: "stdio",
    command: "tsx",
    args: ["10_integrations/_support/mcp-counter-server.ts"],
  },
});
const counterServer = await counterMcp.connect();

try {
  const agentModel = client.completionModel("gpt-5.5");
  const agent = new Agent({
    id: "agent",
    model: agentModel,
    instructions: "Use MCP tools for arithmetic and counter updates.",
    mcpServers: [counterServer],
    maxTurns: 3,
  });

  for await (const event of agent.stream({
    prompt: "Add 8 and 13, then increment the counter by the result.",
  })) {
    if (event.type === "tool_call") {
      console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
    }

    if (event.type === "tool_result") {
      console.log("tool result:", event.toolName, event.result);
    }

    if (event.type === "final") {
      console.log("final:", event.result.text);
    }
  }
} finally {
  await counterMcp.close();
}
