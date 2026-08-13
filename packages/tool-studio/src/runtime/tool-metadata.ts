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
  const approval = tool.approval;
  if (approval === undefined || typeof approval !== "object" || approval === null) {
    return { required: false };
  }

  const policy = approval as {
    reason?: unknown;
    rejectMessage?: unknown;
  };
  const metadata: StudioAgentToolApprovalMetadata = { required: true };
  if (typeof policy.reason === "string") metadata.reason = policy.reason;
  if (typeof policy.rejectMessage === "string") metadata.rejectMessage = policy.rejectMessage;
  return metadata;
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
