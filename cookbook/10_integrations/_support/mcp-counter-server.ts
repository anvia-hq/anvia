import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "anvia-cookbook-counter",
  version: "0.1.0",
});

let count = 0;

server.registerTool(
  "add",
  {
    description: "Add two numbers together.",
    inputSchema: {
      x: z.number().describe("The first number."),
      y: z.number().describe("The second number."),
    },
  },
  async ({ x, y }) => ({
    content: [{ type: "text", text: String(x + y) }],
  }),
);

server.registerTool(
  "increment_counter",
  {
    description: "Increment the local counter and return the new value.",
    inputSchema: {
      by: z.number().int().default(1).describe("The amount to increment by."),
    },
  },
  async ({ by }) => {
    count += by;
    return {
      content: [{ type: "text", text: String(count) }],
    };
  },
);

await server.connect(new StdioServerTransport());
