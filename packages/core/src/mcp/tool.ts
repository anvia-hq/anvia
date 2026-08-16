import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { JsonObject, ToolDefinition } from "../completion/index";
import { ToolOutput } from "../tool";
import { createCallToolParams, mapMcpToolResult } from "./result";
import type { McpTool } from "./types";

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
    async call(args, context) {
      const result = await client.callTool(
        createCallToolParams(definition.name, args),
        undefined,
        context?.abortSignal === undefined ? {} : { signal: context.abortSignal },
      );
      return ToolOutput.content(mapMcpToolResult(result));
    },
  };
  return Object.freeze(tool);
}

export function isMcpTool(tool: unknown): tool is McpTool {
  if (typeof tool !== "object" || tool === null || !("mcp" in tool)) {
    return false;
  }
  const mcp = tool.mcp;
  return (
    typeof mcp === "object" &&
    mcp !== null &&
    "serverName" in mcp &&
    typeof mcp.serverName === "string" &&
    mcp.serverName.length > 0 &&
    "remoteName" in mcp &&
    typeof mcp.remoteName === "string" &&
    mcp.remoteName.length > 0
  );
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
