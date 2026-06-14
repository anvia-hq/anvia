import { createMcpTool } from "./tool";
import type { McpConnection, McpServer } from "./types";

export async function connectMcp(connection: McpConnection): Promise<McpServer> {
  const client = await connection.connect();
  let tools: Awaited<ReturnType<typeof client.listTools>>["tools"];
  try {
    ({ tools } = await client.listTools());
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Preserve the initialization failure so callers see the actionable MCP error.
    }
    throw error;
  }

  return {
    name: connection.name,
    tools: tools.map((tool) => createMcpTool(tool, client, connection.name)),
    close: () => client.close(),
  };
}
