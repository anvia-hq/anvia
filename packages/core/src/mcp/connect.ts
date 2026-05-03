import { createMcpTool } from "./tool";
import type { McpConnection, McpServer } from "./types";

export async function connectMcp(connection: McpConnection): Promise<McpServer> {
  const client = await connection.connect();
  const { tools } = await client.listTools();

  return {
    name: connection.name,
    tools: tools.map((tool) => createMcpTool(tool, client)),
    close: () => client.close(),
  };
}
