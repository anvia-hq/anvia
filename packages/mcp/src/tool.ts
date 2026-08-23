import type { JsonObject, ToolDefinition } from "@anvia/core/completion";
import type { McpTool } from "@anvia/core/mcp";
import { ToolOutput } from "@anvia/core/tool";
import type { Client } from "@modelcontextprotocol/client";
import { createCallToolParams, mapMcpToolResult, parseMcpToolArguments } from "./result";

type SdkMcpToolDefinition = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export function createMcpTool(options: {
  definition: SdkMcpToolDefinition;
  client: Client;
  serverName: string;
  prefix?: string | undefined;
}): McpTool {
  const { definition, client, serverName, prefix = "" } = options;
  const exposedName = `${prefix}${definition.name}`;
  const provenance = Object.freeze({
    serverName,
    remoteName: definition.name,
  });
  const toolDefinition = Object.freeze<ToolDefinition>({
    name: exposedName,
    description: definition.description ?? "",
    parameters: deepFreeze(structuredClone(definition.inputSchema)) as unknown as JsonObject,
  });
  const tool: McpTool = {
    name: exposedName,
    mcp: provenance,
    definition(): ToolDefinition {
      return toolDefinition;
    },
    parseInput(args) {
      return parseMcpToolArguments(args);
    },
    async call(args, context) {
      const result = await client.callTool(
        createCallToolParams(definition.name, args),
        context?.abortSignal === undefined ? {} : { signal: context.abortSignal },
      );
      return ToolOutput.content(mapMcpToolResult(result));
    },
  };
  return Object.freeze(tool);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
