import { type AnyTool, ToolSet } from "@anvia/core/tool";
import type { StudioAgent, StudioAgentToolApprovalMetadata, StudioAgentToolSource } from "../types";

export type AgentToolItem = {
  tool: AnyTool;
  source: StudioAgentToolSource;
};

const MCP_TOOL_METADATA_KEY = Symbol.for("anvia.mcp.tool.metadata");

export function agentToolItems(agent: StudioAgent): AgentToolItem[] {
  return [
    ...agent.agent.toolSet.values().map((tool) => ({ tool, source: "static" as const })),
    ...agent.agent.dynamicTools.flatMap((registration) => {
      const maybeToolSet = (registration.index as { toolSet?: unknown }).toolSet;
      if (!(maybeToolSet instanceof ToolSet)) {
        return [];
      }
      return maybeToolSet.values().map((tool) => ({ tool, source: "dynamic" as const }));
    }),
  ];
}

export function approvalMetadata(tool: AnyTool): StudioAgentToolApprovalMetadata {
  const approval = tool.approval;
  if (approval === undefined || typeof approval !== "object" || approval === null) {
    return { required: false };
  }

  const policy = approval as {
    reason?: unknown;
    rejectMessage?: unknown;
  };
  return {
    required: true,
    ...(typeof policy.reason === "string" ? { reason: policy.reason } : {}),
    ...(typeof policy.rejectMessage === "string" ? { rejectMessage: policy.rejectMessage } : {}),
  };
}

export function mcpServerName(tool: AnyTool): string | undefined {
  const metadata = (tool as { [MCP_TOOL_METADATA_KEY]?: unknown })[MCP_TOOL_METADATA_KEY];
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const serverName = (metadata as { serverName?: unknown }).serverName;
  return typeof serverName === "string" && serverName.length > 0 ? serverName : undefined;
}

export function agentHasMcpTools(agent: StudioAgent): boolean {
  return agentToolItems(agent).some(({ tool }) => mcpServerName(tool) !== undefined);
}
