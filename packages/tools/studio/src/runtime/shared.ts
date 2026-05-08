import { join } from "node:path";
import type { AgentTraceOptions, JsonObject, JsonValue, Message } from "@anvia/core";
import type { Context } from "hono";
import { createSqliteSessionStore } from "../storage/sqlite-store";
import type {
  StudioAgent,
  StudioAgentConfig,
  StudioCapability,
  StudioCapabilityConfig,
  StudioConfig,
  StudioErrorCode,
  StudioErrorResponse,
  StudioSessionStore,
  StudioStores,
  StudioTraceStatus,
  StudioTraceStore,
  StudioUiOptions,
} from "../types";

export type ResolvedStores = {
  sessions?: StudioSessionStore;
  traces?: StudioTraceStore;
};

export type StudioRuntimeOptions = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  agents: StudioAgent[];
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
};

export function resolveStores(options: StudioRuntimeOptions): ResolvedStores {
  const defaultPath =
    process.env.ANVIA_STUDIO_DB ??
    process.env.AION_STUDIO_DB ??
    join(process.cwd(), ".anvia-studio", `${safeFileName(runnerId(options))}.sqlite`);
  const defaultStore = createSqliteSessionStore({ path: defaultPath });
  const sessions = resolveSessionStore(options, defaultStore);
  const traces = resolveTraceStore(options, sessions, defaultStore);
  return {
    ...(sessions === undefined ? {} : { sessions }),
    ...(traces === undefined ? {} : { traces }),
  };
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

function isTraceStore(store: StudioSessionStore): store is StudioSessionStore & StudioTraceStore {
  const candidate = store as Partial<StudioTraceStore>;
  return (
    typeof candidate.listSessionTraces === "function" &&
    typeof candidate.getTrace === "function" &&
    typeof candidate.saveTrace === "function"
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

export function buildConfig(
  options: StudioRuntimeOptions,
  agents: StudioAgent[],
  stores: ResolvedStores,
): StudioConfig {
  return {
    id: runnerId(options),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.version === undefined ? {} : { version: options.version }),
    agents: agents.map(agentConfig),
    chat: {
      quickPrompts: Object.fromEntries(agents.map((agent) => [agent.id, agent.quickPrompts ?? []])),
    },
    capabilities: capabilityConfig(options, agents, stores),
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

export function capabilityConfig(
  _options: StudioRuntimeOptions,
  agents: StudioAgent[],
  stores: ResolvedStores,
): Partial<Record<StudioCapability, StudioCapabilityConfig>> {
  const capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>> = {
    agents: { enabled: true },
  };

  if (stores.sessions !== undefined) {
    capabilities.sessions = { enabled: true };
  }
  if (stores.traces !== undefined) {
    capabilities.traces = { enabled: true };
  }

  if (agents.some((agent) => agent.agent.observers.length > 0)) {
    capabilities.observability = { enabled: true };
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

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "anvia-studio";
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
