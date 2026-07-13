import { createInMemoryStudioStore } from "../storage/memory-store";
import type {
  StudioAgent,
  StudioPipeline,
  StudioPipelineLogStore,
  StudioPipelineRunStore,
  StudioSessionStore,
  StudioTraceStore,
} from "../types";
import type { ResolvedStores, StudioRuntimeOptions } from "./options";

export type { ResolvedStores, StudioRuntimeOptions } from "./options";

export function resolveStores(options: StudioRuntimeOptions): ResolvedStores {
  const defaultStore = defaultStudioStore();
  const sessions = resolveSessionStore(options, defaultStore);
  const traces = resolveTraceStore(options, sessions, defaultStore);
  const pipelineLogs = resolvePipelineLogStore(options, sessions, defaultStore);
  const pipelineRuns = resolvePipelineRunStore(options, sessions, pipelineLogs, defaultStore);
  const stores: ResolvedStores = {};
  if (sessions !== undefined) stores.sessions = sessions;
  if (traces !== undefined) stores.traces = traces;
  if (pipelineLogs !== undefined) stores.pipelineLogs = pipelineLogs;
  if (pipelineRuns !== undefined) stores.pipelineRuns = pipelineRuns;
  return stores;
}

function defaultStudioStore(): StudioSessionStore &
  StudioTraceStore &
  StudioPipelineLogStore &
  StudioPipelineRunStore {
  return createInMemoryStudioStore();
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
    typeof candidate.getPipelineRun === "function" &&
    typeof candidate.listPipelineRuns === "function"
  );
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
