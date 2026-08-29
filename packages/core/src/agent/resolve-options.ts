import type { CompletionModel, ProviderTool } from "../completion";
import { isProviderTool } from "../completion/types";
import { appendGuardrailPolicies } from "../guardrails";
import { isMcpTool } from "../mcp";
import { resolveMemoryOptions } from "../memory/options";
import { isToolIndex, type ToolIndex } from "../tool/dynamic-tools";
import type { AnyTool } from "../tool/tool";
import type { AgentMemory, AgentOptions, ResolvedAgentOptions } from "./types";

const resolvedAgentOptions = Symbol("resolvedAgentOptions");

type InternalAgentOptions<
  Output,
  M extends CompletionModel,
  ContextDocument,
> = ResolvedAgentOptions<Output, M, ContextDocument> & {
  [resolvedAgentOptions]: true;
};

export function resolveAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
): ResolvedAgentOptions<Output, M, ContextDocument> {
  if (isInternalAgentOptions(options)) {
    return options as unknown as ResolvedAgentOptions<Output, M, ContextDocument>;
  }

  const toolsByName = new Map<string, AnyTool>();
  const providerTools: ProviderTool[] = [];
  const toolIndexes: ToolIndex[] = [];
  for (const tool of options.tools ?? []) {
    if (isProviderTool(tool)) {
      providerTools.push(tool);
    } else if (isToolIndex(tool)) {
      toolIndexes.push(tool);
    } else if ((tool as { kind?: unknown }).kind === "tool-index") {
      throw new TypeError("Invalid tool index: search, tools, and a numeric topK are required.");
    } else if (isMcpTool(tool)) {
      throw new TypeError(
        `MCP tool "${tool.name}" must be registered through Agent.mcpServers, not Agent.tools.`,
      );
    } else {
      addUniqueTool(toolsByName, tool, "local tool");
    }
  }
  if (options.skills !== undefined) {
    for (const tool of options.skills.tools) {
      if (isMcpTool(tool)) {
        throw new TypeError(
          `MCP tool "${tool.name}" must be registered through Agent.mcpServers, not Agent.skills.`,
        );
      }
      addUniqueTool(toolsByName, tool, "skill tool");
    }
  }
  const memory = resolveAgentMemory(options);
  const instructions = [options.instructions, options.skills?.instructions]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    model: options.model,
    instructions: instructions.length === 0 ? undefined : instructions,
    context: [...(options.context ?? [])],
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    providerOptions: options.providerOptions,
    controls: options.controls,
    retries: options.retries,
    tools: [...toolsByName.values()],
    mcpServers: [...(options.mcpServers ?? [])],
    providerTools,
    toolIndexes,
    toolChoice: options.toolChoice,
    defaultMaxTurns: options.maxTurns,
    lifecycle: options.lifecycle,
    outputSchema: options.outputSchema,
    observability: options.observability,
    guardrails:
      options.guardrails === undefined ? [] : appendGuardrailPolicies([], options.guardrails),
    middlewares: [...(options.middlewares ?? [])],
    memory,
  };
}

export function markResolvedAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  options: ResolvedAgentOptions<Output, M, ContextDocument>,
): AgentOptions<Output, M, ContextDocument> {
  return {
    ...options,
    [resolvedAgentOptions]: true,
  } as unknown as AgentOptions<Output, M, ContextDocument>;
}

function isInternalAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
): boolean {
  return (
    (options as unknown as Partial<InternalAgentOptions<Output, M, ContextDocument>>)[
      resolvedAgentOptions
    ] === true
  );
}

function resolveAgentMemory<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
): AgentMemory | undefined {
  if (options.memory === undefined) {
    return undefined;
  }
  const { store, ...memoryOptions } = options.memory;
  const resolvedOptions = resolveMemoryOptions(memoryOptions);
  if (resolvedOptions.compaction !== undefined && store.compaction === undefined) {
    throw new TypeError(
      "Memory compaction requires a store with the optional compaction capability.",
    );
  }
  return { store, ...resolvedOptions };
}

function addUniqueTool(tools: Map<string, AnyTool>, tool: AnyTool, source: string): void {
  if (tools.has(tool.name)) {
    throw new TypeError(`Duplicate ${source} name "${tool.name}".`);
  }
  tools.set(tool.name, tool);
}
