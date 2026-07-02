import { AgentBuilder } from "@anvia/core/agent";
import { connectMcp, mcp } from "@anvia/core/mcp";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const port = Number(process.env.RUNNER_PORT ?? 4021);

const counterMcp = await connectMcp(
  mcp.stdio({
    name: "counter",
    command: "tsx",
    args: ["10_integrations/_support/mcp-counter-server.ts"],
  }),
);

const model = client.completionModel("gpt-5.5");
const agent = new AgentBuilder("studio-mcp-counter", model)
  .name("Studio MCP Counter")
  .description("Demonstrates MCP tools surfaced through Studio.")
  .instructions(
    [
      "Use MCP tools for arithmetic and counter updates.",
      "When the user asks to add numbers, call the add MCP tool.",
      "When the user asks to update the counter, call increment_counter.",
    ].join("\n"),
  )
  .mcp([counterMcp])
  .defaultMaxTurns(4)
  .build();

new Studio([agent], {
  quickPrompts: {
    "studio-mcp-counter": [
      "Add 8 and 13, then increment the counter by the result.",
      "Increment the counter by 3 and tell me the new value.",
      "What MCP tools are available to you?",
    ],
  },
}).start({ port });

console.log(`Open http://localhost:${port}/ui/playground to chat with the MCP-backed agent.`);
console.log(`Open http://localhost:${port}/ui/mcps to inspect and run connected MCP tools.`);
console.log(`Open http://localhost:${port}/ui/tools to see all registered Studio tools.`);
