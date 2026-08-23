import type {
  StudioAgent,
  StudioEvalSuite,
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
  models?: StudioModelConfig;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
  sandboxes?: readonly StudioSandboxRegistration[];
};
