import type { JsonValue } from "@anvia/core/completion";
import type {
  StudioAgent,
  StudioAgentConfig,
  StudioAgentRuntimeSummary,
  StudioCapability,
  StudioCapabilityConfig,
  StudioConfig,
  StudioPipeline,
  StudioPipelineConfig,
} from "../types";
import { evalConfig } from "./eval-config";
import { serializeUnknown } from "./json";
import { createStudioModelRegistry, studioModelsConfig } from "./models";
import type { ResolvedStores, StudioRuntimeOptions } from "./options";
import { agentHasMcpTools, agentToolItems, mcpServerName } from "./tool-metadata";

export type { ResolvedStores, StudioRuntimeOptions } from "./options";

export function runnerId(options: StudioRuntimeOptions): string {
  return options.id ?? "anvia-studio";
}

export function agentConfig(agent: StudioAgent): StudioAgentConfig {
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  const config: StudioAgentConfig = {
    id: agent.id,
    quickPrompts: agent.quickPrompts ?? [],
  };
  if (name !== undefined) config.name = name;
  if (description !== undefined) config.description = description;
  if (agent.metadata !== undefined) config.metadata = agent.metadata;
  return config;
}

export function agentRuntimeSummary(agent: StudioAgent): StudioAgentRuntimeSummary {
  const tools = agentToolItems(agent);
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  const summary: StudioAgentRuntimeSummary = {
    id: agent.id,
    model: toJsonValue(agent.agent.model),
    toolCount: tools.length,
    staticToolCount: tools.filter((item) => item.source === "static").length,
    dynamicToolCount: tools.filter((item) => item.source === "dynamic").length,
    approvalToolCount: tools.filter((item) => item.tool.approval !== undefined).length,
    mcpToolCount: tools.filter((item) => mcpServerName(item.tool) !== undefined).length,
    staticContextCount: agent.agent.staticContext.length,
    dynamicContextCount: agent.agent.dynamicContexts.length,
    observerCount: agent.agent.observers.length,
    hasMemory: agent.agent.memory !== undefined,
    hasHook: agent.agent.hook !== undefined,
    hasOutputSchema: agent.agent.outputSchema !== undefined,
  };
  if (name !== undefined) summary.name = name;
  if (description !== undefined) summary.description = description;
  if (agent.agent.defaultMaxTurns !== undefined) {
    summary.defaultMaxTurns = agent.agent.defaultMaxTurns;
  }
  if (agent.metadata !== undefined) summary.metadata = agent.metadata;
  return summary;
}

export function pipelineConfig(pipeline: StudioPipeline): StudioPipelineConfig {
  const graph = pipeline.pipeline.graph();
  const stageNodes = graph.nodes.filter((node) => node.kind !== "input" && node.kind !== "output");
  const config: StudioPipelineConfig = {
    id: pipeline.id,
    stageCount: stageNodes.length,
    edgeCount: graph.edges.length,
    hasParallelStages: graph.nodes.some((node) => node.kind === "parallel"),
    agentCount: graph.nodes.filter((node) => node.kind === "agent").length,
    extractorCount: graph.nodes.filter((node) => node.kind === "extractor").length,
  };
  if (pipeline.name !== undefined) config.name = pipeline.name;
  if (pipeline.description !== undefined) config.description = pipeline.description;
  if (pipeline.metadata !== undefined) config.metadata = pipeline.metadata;
  return config;
}

export function buildConfig(
  options: StudioRuntimeOptions,
  agents: StudioAgent[],
  pipelines: StudioPipeline[],
  stores: ResolvedStores,
): StudioConfig {
  const models =
    options.models === undefined
      ? undefined
      : studioModelsConfig(createStudioModelRegistry(options.models), agents);
  const config: StudioConfig = {
    id: runnerId(options),
    agents: agents.map(agentConfig),
    pipelines: pipelines.map(pipelineConfig),
    evals: options.evals.map(evalConfig),
    chat: {
      quickPrompts: Object.fromEntries(agents.map((agent) => [agent.id, agent.quickPrompts ?? []])),
    },
    capabilities: capabilityConfig(options, agents, pipelines, stores),
    unsupportedCapabilities: unsupportedCapabilities(stores),
  };
  if (options.name !== undefined) config.name = options.name;
  if (options.description !== undefined) config.description = options.description;
  if (options.version !== undefined) config.version = options.version;
  if (models !== undefined) config.models = models;
  return config;
}

export function capabilityConfig(
  _options: StudioRuntimeOptions,
  agents: StudioAgent[],
  pipelines: StudioPipeline[],
  stores: ResolvedStores,
): Partial<Record<StudioCapability, StudioCapabilityConfig>> {
  const capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>> = {
    agents: { enabled: true },
    observability: { enabled: true },
    status: { enabled: true },
  };

  if (stores.sessions !== undefined) {
    capabilities.sessions = { enabled: true };
    capabilities.memory = { enabled: true };
  }
  if (stores.traces !== undefined) {
    capabilities.traces = { enabled: true };
  }
  if (pipelines.length > 0) {
    capabilities.pipelines = { enabled: true };
  }
  if (_options.evals.length > 0) {
    capabilities.evals = { enabled: true };
  }
  if (
    agents.some(
      (agent) => agent.agent.toolSet.values().length > 0 || agent.agent.dynamicTools.length > 0,
    )
  ) {
    capabilities.tools = { enabled: true };
  }
  if (agents.some(agentHasMcpTools)) {
    capabilities.mcps = { enabled: true };
  }

  if (
    agents.some(
      (agent) =>
        agent.agent.hook !== undefined ||
        agent.agent.toolSet.values().some((tool) => tool.approval),
    )
  ) {
    capabilities.approvals = { enabled: true };
  }
  if (
    agents.some(
      (agent) =>
        agent.agent.staticContext.length > 0 ||
        agent.agent.dynamicContexts.length > 0 ||
        agent.agent.dynamicTools.length > 0,
    )
  ) {
    capabilities.knowledge = { enabled: true };
  }
  return capabilities;
}

export function unsupportedCapabilities(
  stores: ResolvedStores,
): import("../types").StudioCapability[] {
  const capabilities: import("../types").StudioCapability[] = [];
  if (stores.sessions === undefined) capabilities.push("sessions");
  if (stores.traces === undefined) capabilities.push("traces");
  return capabilities;
}

function toJsonValue(value: unknown): JsonValue {
  return serializeUnknown(value);
}
