import type { JsonValue, ProviderTool } from "../completion";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import { isMcpTool, type McpServer } from "../mcp";
import { isToolIndex, type ToolIndex } from "../tool/dynamic-tools";
import type { AnyTool, ToolCallContext } from "../tool/tool";
import type { VectorInspectRequest } from "../vector-store";
import { cloneFrozenPlainData } from "./snapshot";
import type { AgentToolState } from "./tool-state";
import type { ResolvedAgentOptions } from "./types";

export type PreparedAgentTools = {
  mcpServers: readonly McpServer[];
  tools: readonly AnyTool[];
  publicState: AgentToolState;
  toolsByName: Map<string, AnyTool>;
};

export function prepareAgentTools(
  options: Pick<ResolvedAgentOptions, "tools" | "mcpServers" | "providerTools" | "toolIndexes">,
): PreparedAgentTools {
  assertUniqueMcpServerNames(options.mcpServers ?? []);
  const mcpServers = Object.freeze((options.mcpServers ?? []).map(snapshotMcpServer));
  const configuredTools = [...(options.tools ?? [])];
  const staticTools = [...configuredTools, ...mcpServers.flatMap((server) => server.tools)];
  const toolIndexes = (options.toolIndexes ?? []).map(snapshotToolIndex);
  const providerTools = (options.providerTools ?? []).map(snapshotProviderTool);
  assertUniqueAgentToolNames({ staticTools, providerTools, toolIndexes });

  const toolsByName = new Map(staticTools.map((tool) => [tool.name, tool]));
  for (const index of toolIndexes) {
    for (const tool of index.tools) {
      toolsByName.set(tool.name, tool);
    }
  }
  const tools = Object.freeze([...toolsByName.values()]);
  const publicState = Object.freeze({
    configuredTools: Object.freeze(configuredTools),
    staticTools: Object.freeze(staticTools),
    providerTools: Object.freeze(providerTools),
    toolIndexes: Object.freeze(toolIndexes),
  });
  return { mcpServers, tools, publicState, toolsByName };
}

function assertUniqueAgentToolNames(options: {
  staticTools: readonly AnyTool[];
  providerTools: readonly ProviderTool[];
  toolIndexes: readonly ToolIndex[];
}): void {
  const owners = new Map<string, string>();
  for (const tool of options.staticTools) {
    registerToolOwner(owners, tool.name, isMcpTool(tool) ? "MCP tool" : "local or skill tool");
  }
  for (const tool of options.providerTools) {
    registerToolOwner(owners, tool.name, "provider tool");
  }
  for (const [indexPosition, index] of options.toolIndexes.entries()) {
    if (!isToolIndex(index)) {
      throw new TypeError("Invalid tool index: search, tools, and a numeric topK are required.");
    }
    assertPositiveSearchLimit(index.topK);
    assertFiniteMinScore(index.minScore);
    for (const tool of index.tools) {
      if (isMcpTool(tool)) {
        throw new TypeError(
          `MCP tool "${tool.name}" must be registered through Agent.mcpServers, not a tool index.`,
        );
      }
      registerToolOwner(owners, tool.name, `tool index ${indexPosition + 1}`);
    }
  }
}

function registerToolOwner(owners: Map<string, string>, name: string, owner: string): void {
  const existing = owners.get(name);
  if (existing !== undefined) {
    throw new TypeError(
      `Tool name collision for "${name}" between ${existing} and ${owner}. Tool names must be unique across every Agent tool source.`,
    );
  }
  owners.set(name, owner);
}

function snapshotProviderTool(tool: ProviderTool): ProviderTool {
  let snapshot: ProviderTool = {
    ...tool,
  };
  if (tool.configuration !== undefined) {
    snapshot = { ...snapshot, configuration: cloneFrozenPlainData(tool.configuration) };
  }
  return Object.freeze(snapshot);
}

function snapshotMcpServer(server: McpServer): McpServer {
  if (server.name.trim() === "") {
    throw new TypeError("MCP server name must not be empty.");
  }
  for (const tool of server.tools) {
    if (!isMcpTool(tool)) {
      throw new TypeError(`MCP server "${server.name}" contains an invalid MCP tool.`);
    }
    if (tool.mcp.serverName !== server.name) {
      throw new TypeError(
        `MCP tool "${tool.name}" belongs to server "${tool.mcp.serverName}", not "${server.name}".`,
      );
    }
  }
  const tools = server.tools.map(snapshotMcpTool);
  let snapshot: McpServer = {
    name: server.name,
    tools: Object.freeze(tools),
  };
  if (server.serverInfo !== undefined) {
    snapshot = { ...snapshot, serverInfo: cloneFrozenPlainData(server.serverInfo) };
  }
  if (server.capabilities !== undefined) {
    snapshot = { ...snapshot, capabilities: cloneFrozenPlainData(server.capabilities) };
  }
  if (server.instructions !== undefined) {
    snapshot = { ...snapshot, instructions: server.instructions };
  }
  return Object.freeze(snapshot);
}

function snapshotMcpTool(tool: McpServer["tools"][number]): McpServer["tools"][number] {
  if (Object.isFrozen(tool) && Object.isFrozen(tool.mcp)) {
    return tool;
  }
  const parseInput = tool.parseInput;
  let snapshot: McpServer["tools"][number] = {
    name: tool.name,
    mcp: Object.freeze({ ...tool.mcp }),
    definition: (prompt: string) => tool.definition(prompt),
    call: (args: unknown, context?: ToolCallContext) => tool.call(args, context),
  };
  if (tool.requiresApproval !== undefined) {
    snapshot = { ...snapshot, requiresApproval: tool.requiresApproval };
  }
  if (parseInput !== undefined) {
    snapshot = {
      ...snapshot,
      parseInput: (args: JsonValue) => parseInput.call(tool, args),
    };
  }
  return Object.freeze(snapshot);
}

function assertUniqueMcpServerNames(servers: readonly McpServer[]): void {
  const names = new Set<string>();
  for (const server of servers) {
    if (names.has(server.name)) {
      throw new TypeError(`Duplicate MCP server name "${server.name}".`);
    }
    names.add(server.name);
  }
}

function snapshotToolIndex(index: ToolIndex): ToolIndex {
  const inspect = index.inspect;
  let snapshot: ToolIndex = {
    kind: "tool-index" as const,
    tools: Object.freeze([...index.tools]),
    topK: index.topK,
    search: (options: { query: string; abortSignal?: AbortSignal | undefined }) =>
      index.search(options),
  };
  if (index.minScore !== undefined) {
    snapshot = { ...snapshot, minScore: index.minScore };
  }
  if (index.filter !== undefined) {
    snapshot = { ...snapshot, filter: cloneFrozenPlainData(index.filter) };
  }
  if (inspect !== undefined) {
    snapshot = {
      ...snapshot,
      inspect: (request: VectorInspectRequest) => inspect.call(index, request),
    };
  }
  return Object.freeze(snapshot);
}
