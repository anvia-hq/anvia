import { getAgentToolState } from "@anvia/core/internal/agent";
import type { AnyTool } from "@anvia/core/tool";
import type { StudioAgent, StudioAgentToolApprovalMetadata, StudioAgentToolSource } from "../types";

export type AgentToolItem = {
  tool: AnyTool;
  source: StudioAgentToolSource;
};

const MCP_TOOL_METADATA_KEY = Symbol.for("anvia.mcp.tool.metadata");

export function agentToolItems(agent: StudioAgent): AgentToolItem[] {
  const state = getAgentToolState(agent.agent);
  const items: AgentToolItem[] = state.staticTools.map((tool) => ({ tool, source: "static" }));
  const names = new Set(items.map(({ tool }) => tool.name));

  for (const index of state.toolIndexes) {
    for (const tool of index.tools) {
      if (!names.has(tool.name)) {
        names.add(tool.name);
        items.push({ tool, source: "dynamic" });
      }
    }
  }

  return items;
}

export function approvalMetadata(tool: AnyTool): StudioAgentToolApprovalMetadata {
  const approval = tool.requiresApproval;
  if (approval === undefined || approval === false) {
    return { required: false };
  }

  if (typeof approval !== "object" || approval === null) {
    return { required: true };
  }

  const policy = approval as { reason?: unknown };
  const metadata: StudioAgentToolApprovalMetadata = { required: true };
  if (typeof policy.reason === "string") metadata.reason = policy.reason;
  return metadata;
}

export function toolRequiresApproval(tool: AnyTool): boolean {
  const approval = tool.requiresApproval;
  return approval !== undefined && approval !== false;
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
