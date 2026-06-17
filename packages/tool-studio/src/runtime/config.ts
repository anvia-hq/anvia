import type { JsonValue } from "@anvia/core/completion";
import { compact } from "./compact";
import type {
  StudioAgent,
  StudioAgentConfig,
  StudioAgentRuntimeSummary,
  StudioCapability,
  StudioCapabilityConfig,
  StudioConfig,
  StudioEvalSuite,
  StudioEvalSuiteConfig,
  StudioPipeline,
  StudioPipelineConfig,
  StudioStores,
  StudioUiOptions,
} from "../types";
import { serializeUnknown } from "./json";
import { createStudioModelRegistry, studioModelsConfig } from "./models";
import { agentHasMcpTools, agentToolItems, mcpServerName } from "./tool-metadata";

export type ResolvedStores = {
  sessions?: import("../types").StudioSessionStore;
  traces?: import("../types").StudioTraceStore;
  pipelineLogs?: import("../types").StudioPipelineLogStore;
  pipelineRuns?: import("../types").StudioPipelineRunStore;
};

export type StudioRuntimeOptions = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  agents: StudioAgent[];
  pipelines: StudioPipeline[];
  evals: StudioEvalSuite[];
  models?: import("../types").StudioModelConfig;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
};

export function runnerId(options: StudioRuntimeOptions): string {
  return options.id ?? "anvia-studio";
}

export function agentConfig(agent: StudioAgent): StudioAgentConfig {
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  return compact({
    id: agent.id,
    name,
    description,
    quickPrompts: agent.quickPrompts ?? [],
    metadata: agent.metadata,
  }) as StudioAgentConfig;
}

export function agentRuntimeSummary(agent: StudioAgent): StudioAgentRuntimeSummary {
  const tools = agentToolItems(agent);
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  return compact({
    id: agent.id,
    name,
    description,
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
    defaultMaxTurns: agent.agent.defaultMaxTurns,
    metadata: agent.metadata,
  }) as StudioAgentRuntimeSummary;
}

export function pipelineConfig(pipeline: StudioPipeline): StudioPipelineConfig {
  const graph = pipeline.pipeline.graph();
  const stageNodes = graph.nodes.filter((node) => node.kind !== "input" && node.kind !== "output");
  return compact({
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    metadata: pipeline.metadata,
    stageCount: stageNodes.length,
    edgeCount: graph.edges.length,
    hasParallelStages: graph.nodes.some((node) => node.kind === "parallel"),
    agentCount: graph.nodes.filter((node) => node.kind === "agent").length,
    extractorCount: graph.nodes.filter((node) => node.kind === "extractor").length,
  }) as StudioPipelineConfig;
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
  return compact({
    id: runnerId(options),
    name: options.name,
    description: options.description,
    version: options.version,
    agents: agents.map(agentConfig),
    models,
    pipelines: pipelines.map(pipelineConfig),
    evals: options.evals.map(evalConfig),
    chat: {
      quickPrompts: Object.fromEntries(agents.map((agent) => [agent.id, agent.quickPrompts ?? []])),
    },
    capabilities: capabilityConfig(options, agents, pipelines, stores),
    unsupportedCapabilities: unsupportedCapabilities(stores),
  }) as StudioConfig;
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

export function evalConfig(suite: StudioEvalSuite): StudioEvalSuiteConfig {
  return compact({
    id: suite.id ?? suite.name,
    name: suite.name,
    description: suite.description,
    caseCount: suite.cases.length,
    metricNames: suite.metrics.map((metric) => metric.name),
    concurrency: suite.concurrency,
    metadata: suite.metadata,
  }) as StudioEvalSuiteConfig;
}

export function unsupportedCapabilities(stores: ResolvedStores): import("../types").StudioCapability[] {
  return [
    ...(stores.sessions === undefined ? (["sessions"] as const) : []),
    ...(stores.traces === undefined ? (["traces"] as const) : []),
  ];
}

function toJsonValue(value: unknown): JsonValue {
  return serializeUnknown(value);
}
