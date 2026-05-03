import type { ToolDefinition } from "../completion/index";
import type { Tool } from "../tool/index";
import { createCallToolParams, mapMcpToolResult } from "./result";
import type { McpClient, McpToolDefinition } from "./types";

export function createMcpTool(definition: McpToolDefinition, client: McpClient): Tool {
  return {
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
}
