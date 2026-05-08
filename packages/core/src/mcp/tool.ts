import type { ToolDefinition } from "../completion/index";
import type { Tool } from "../tool/index";
import { createCallToolParams, mapMcpToolResult } from "./result";
import type { McpClient, McpToolDefinition } from "./types";

const MCP_TOOL_METADATA_KEY = Symbol.for("anvia.mcp.tool.metadata");

export function createMcpTool(
  definition: McpToolDefinition,
  client: McpClient,
  serverName?: string,
): Tool {
  const tool: Tool = {
    name: definition.name,
    definition(): ToolDefinition {
      return {
        name: definition.name,
        description: definition.description ?? "",
        parameters: definition.inputSchema,
      };
    },
    async call(args): Promise<string> {
      const result = await client.callTool(createCallToolParams(definition.name, args));
      return mapMcpToolResult(result);
    },
  };
  if (serverName !== undefined) {
    Object.defineProperty(tool, MCP_TOOL_METADATA_KEY, {
      value: { serverName },
      enumerable: false,
    });
  }
  return tool;
}
