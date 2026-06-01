import type { AgentTraceOptions, JsonObject, JsonValue, Message } from "@anvia/core";
import type { Context } from "hono";
import { createInMemoryStudioStore } from "../storage/memory-store";
import { createSqliteSessionStore } from "../storage/sqlite-store";
import type {
  StudioAgent,
  StudioAgentConfig,
  StudioAgentRuntimeSummary,
  StudioCapability,
  StudioCapabilityConfig,
  StudioConfig,
  StudioErrorCode,
  StudioErrorResponse,
  StudioEvalSuite,
  StudioEvalSuiteConfig,
  StudioPipeline,
  StudioPipelineConfig,
  StudioPipelineLogStore,
  StudioPipelineRunStore,
  StudioSessionStore,
  StudioStores,
  StudioTraceStatus,
  StudioTraceStore,
  StudioUiOptions,
} from "../types";
import { toJsonValue } from "./json";
import { agentHasMcpTools, agentToolItems, mcpServerName } from "./tool-metadata";

export type ResolvedStores = {
  sessions?: StudioSessionStore;
  traces?: StudioTraceStore;
  pipelineLogs?: StudioPipelineLogStore;
  pipelineRuns?: StudioPipelineRunStore;
};

export type StudioRuntimeOptions = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  agents: StudioAgent[];
  pipelines: StudioPipeline[];
  evals: StudioEvalSuite[];
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
};

export function resolveStores(options: StudioRuntimeOptions): ResolvedStores {
  const defaultStore = defaultStudioStore();
  const sessions = resolveSessionStore(options, defaultStore);
  const traces = resolveTraceStore(options, sessions, defaultStore);
  const pipelineLogs = resolvePipelineLogStore(options, sessions, defaultStore);
  const pipelineRuns = resolvePipelineRunStore(options, sessions, pipelineLogs, defaultStore);
  return {
    ...(sessions === undefined ? {} : { sessions }),
    ...(traces === undefined ? {} : { traces }),
    ...(pipelineLogs === undefined ? {} : { pipelineLogs }),
    ...(pipelineRuns === undefined ? {} : { pipelineRuns }),
  };
}

function defaultStudioStore(): StudioSessionStore &
  StudioTraceStore &
  StudioPipelineLogStore &
  StudioPipelineRunStore {
  const sqlitePath = process.env.ANVIA_STUDIO_DB ?? process.env.AION_STUDIO_DB;
  return sqlitePath === undefined
    ? createInMemoryStudioStore()
    : createSqliteSessionStore({ path: sqlitePath });
}

function resolveSessionStore(
  options: StudioRuntimeOptions,
  defaultStore: StudioSessionStore,
): StudioSessionStore | undefined {
  if (options.stores?.sessions === false) {
    return undefined;
  }
  if (options.stores?.sessions !== undefined) {
    return options.stores.sessions;
  }

  return defaultStore;
}

function resolveTraceStore(
  options: StudioRuntimeOptions,
  sessionStore: StudioSessionStore | undefined,
  defaultStore: StudioTraceStore,
): StudioTraceStore | undefined {
  if (options.stores?.traces !== undefined) {
    return options.stores.traces;
  }
  if (sessionStore === undefined) {
    return undefined;
  }
  if (isTraceStore(sessionStore)) {
    return sessionStore;
  }
  return defaultStore;
}

function resolvePipelineLogStore(
  options: StudioRuntimeOptions,
  sessionStore: StudioSessionStore | undefined,
  defaultStore: StudioPipelineLogStore,
): StudioPipelineLogStore | undefined {
  if (options.stores?.pipelineLogs === false) {
    return undefined;
  }
  if (options.stores?.pipelineLogs !== undefined) {
    return options.stores.pipelineLogs;
  }
  if (sessionStore !== undefined && isPipelineLogStore(sessionStore)) {
    return sessionStore;
  }
  return defaultStore;
}

function resolvePipelineRunStore(
  options: StudioRuntimeOptions,
  sessionStore: StudioSessionStore | undefined,
  pipelineLogStore: StudioPipelineLogStore | undefined,
  defaultStore: StudioPipelineRunStore,
): StudioPipelineRunStore | undefined {
  if (options.stores?.pipelineRuns === false) {
    return undefined;
  }
  if (options.stores?.pipelineRuns !== undefined) {
    return options.stores.pipelineRuns;
  }
  if (sessionStore !== undefined && isPipelineRunStore(sessionStore)) {
    return sessionStore;
  }
  if (pipelineLogStore !== undefined && isPipelineRunStore(pipelineLogStore)) {
    return pipelineLogStore;
  }
  return defaultStore;
}

function isTraceStore(store: StudioSessionStore): store is StudioSessionStore & StudioTraceStore {
  const candidate = store as Partial<StudioTraceStore>;
  return (
    typeof candidate.listSessionTraces === "function" &&
    typeof candidate.getTrace === "function" &&
    typeof candidate.saveTrace === "function"
  );
}

function isPipelineLogStore(
  store: StudioSessionStore,
): store is StudioSessionStore & StudioPipelineLogStore {
  const candidate = store as Partial<StudioPipelineLogStore>;
  return (
    typeof candidate.appendPipelineLog === "function" &&
    typeof candidate.listPipelineLogs === "function"
  );
}

function isPipelineRunStore(store: object): store is object & StudioPipelineRunStore {
  const candidate = store as Partial<StudioPipelineRunStore>;
  return (
    typeof candidate.savePipelineRun === "function" &&
    typeof candidate.listPipelineRuns === "function"
  );
}

export function unsupportedCapabilities(stores: ResolvedStores): StudioCapability[] {
  return [
    ...(stores.sessions === undefined ? (["sessions"] as const) : []),
    ...(stores.traces === undefined ? (["traces"] as const) : []),
  ];
}

export function normalizeAgents(agents: StudioAgent[]): StudioAgent[] {
  const ids = new Set<string>();
  return agents.map((agent) => {
    const id = agent.id.trim();
    if (id.length === 0) {
      throw new Error("Studio agent id cannot be empty");
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate runner agent id: ${id}`);
    }
    ids.add(id);
    return { ...agent, id };
  });
}

export function normalizePipelines(pipelines: StudioPipeline[]): StudioPipeline[] {
  const ids = new Set<string>();
  return pipelines.map((pipeline) => {
    const id = pipeline.id.trim();
    if (id.length === 0) {
      throw new Error("Studio pipeline id cannot be empty");
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate Studio pipeline id: ${id}`);
    }
    ids.add(id);
    return { ...pipeline, id };
  });
}

export function buildConfig(
  options: StudioRuntimeOptions,
  agents: StudioAgent[],
  pipelines: StudioPipeline[],
  stores: ResolvedStores,
): StudioConfig {
  return {
    id: runnerId(options),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.version === undefined ? {} : { version: options.version }),
    agents: agents.map(agentConfig),
    pipelines: pipelines.map(pipelineConfig),
    evals: options.evals.map(evalConfig),
    chat: {
      quickPrompts: Object.fromEntries(agents.map((agent) => [agent.id, agent.quickPrompts ?? []])),
    },
    capabilities: capabilityConfig(options, agents, pipelines, stores),
    unsupportedCapabilities: unsupportedCapabilities(stores),
  };
}

export function runnerId(options: StudioRuntimeOptions): string {
  return options.id ?? "anvia-studio";
}

export function agentConfig(agent: StudioAgent): StudioAgentConfig {
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  return {
    id: agent.id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    quickPrompts: agent.quickPrompts ?? [],
    ...(agent.metadata === undefined ? {} : { metadata: agent.metadata }),
  };
}

export function agentRuntimeSummary(agent: StudioAgent): StudioAgentRuntimeSummary {
  const tools = agentToolItems(agent);
  const name = agent.name ?? agent.agent.name;
  const description = agent.description ?? agent.agent.description;
  return {
    id: agent.id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
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
    ...(agent.agent.defaultMaxTurns === undefined
      ? {}
      : { defaultMaxTurns: agent.agent.defaultMaxTurns }),
    ...(agent.metadata === undefined ? {} : { metadata: agent.metadata }),
  };
}

export function pipelineConfig(pipeline: StudioPipeline): StudioPipelineConfig {
  const graph = pipeline.pipeline.graph();
  const stageNodes = graph.nodes.filter((node) => node.kind !== "input" && node.kind !== "output");
  return {
    id: pipeline.id,
    ...(pipeline.name === undefined ? {} : { name: pipeline.name }),
    ...(pipeline.description === undefined ? {} : { description: pipeline.description }),
    ...(pipeline.metadata === undefined ? {} : { metadata: pipeline.metadata }),
    stageCount: stageNodes.length,
    edgeCount: graph.edges.length,
    hasParallelStages: graph.nodes.some((node) => node.kind === "parallel"),
    agentCount: graph.nodes.filter((node) => node.kind === "agent").length,
    extractorCount: graph.nodes.filter((node) => node.kind === "extractor").length,
  };
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
  return {
    id: suite.id ?? suite.name,
    name: suite.name,
    ...(suite.description === undefined ? {} : { description: suite.description }),
    caseCount: suite.cases.length,
    metricNames: suite.metrics.map((metric) => metric.name),
    ...(suite.concurrency === undefined ? {} : { concurrency: suite.concurrency }),
    ...(suite.metadata === undefined ? {} : { metadata: suite.metadata }),
  };
}

export function optionalQueryString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return 50;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, 100);
}

export function parseTraceStatus(value: string | undefined): StudioTraceStatus | undefined | false {
  const status = optionalQueryString(value);
  if (status === undefined) {
    return undefined;
  }
  return status === "running" || status === "success" || status === "error" ? status : false;
}

export function isMessageInput(value: unknown): value is string | Message {
  return typeof value === "string" || isMessage(value);
}

export function isMessage(value: unknown): value is Message {
  if (!isObject(value) || typeof value.role !== "string") {
    return false;
  }
  if (value.role === "system") {
    return typeof value.content === "string";
  }
  if (value.role === "user" || value.role === "assistant" || value.role === "tool") {
    return Array.isArray(value.content);
  }
  return false;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

export function isAgentTraceOptions(value: unknown): value is AgentTraceOptions {
  if (!isObject(value)) {
    return false;
  }
  return (
    optionalString(value.name) &&
    optionalString(value.userId) &&
    optionalString(value.sessionId) &&
    optionalString(value.version) &&
    optionalString(value.traceId) &&
    optionalBoolean(value.failOnObserverError) &&
    optionalStringArray(value.tags) &&
    optionalObject(value.metadata)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function optionalObject(value: unknown): boolean {
  return value === undefined || isObject(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

export function unsupportedCapability(c: Context, capability: StudioCapability): Response {
  return errorResponse(
    c,
    501,
    "unsupported_capability",
    `Capability "${capability}" is not implemented by this runner`,
    { capability },
  );
}

export function errorResponse(
  c: Context,
  status: 400 | 404 | 409 | 500 | 501,
  code: StudioErrorCode,
  message: string,
  details?: JsonValue,
): Response {
  const body: StudioErrorResponse = {
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return c.json(body, status);
}

export function serializeError(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return isJsonValue(error) ? error : String(error);
}
