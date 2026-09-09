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
};
