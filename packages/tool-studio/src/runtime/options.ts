import type {
  StudioAgent,
  StudioEvalSuite,
  StudioGraphRegistration,
  StudioModelConfig,
  StudioPipeline,
  StudioPipelineLogStore,
  StudioPipelineRunStore,
  StudioSandboxRegistration,
  StudioSessionStore,
  StudioStores,
  StudioTraceStore,
  StudioUiOptions,
} from "../types";
import type { AgentTeam } from "@anvia/core/agent";

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
  teams?: readonly AgentTeam<unknown>[];
  pipelines: StudioPipeline[];
  evals: StudioEvalSuite[];
  models?: StudioModelConfig;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
  sandboxes?: readonly StudioSandboxRegistration[];
  graphs: StudioGraphRegistration[];
  /**
   * Extra Host header hostnames (and Origin hosts) trusted alongside the
   * loopback set. Populated from `StudioServeOptions.allowedHosts` when
   * serving; in-process `fetch` callers use the loopback default.
   */
  allowedHosts?: readonly string[];
  /**
   * Bind hostname from `StudioServeOptions.hostname`. An explicit
   * non-wildcard value is trusted automatically so the bind address works
   * without extra config.
   */
  hostname?: string;
};
