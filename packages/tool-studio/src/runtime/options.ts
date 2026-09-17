import type {
  StudioAgent,
  StudioEvalSuite,
  StudioGraphRegistration,
  StudioModelConfig,
  StudioMachineMonitorOptions,
  StudioMachineMonitorStore,
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
  machineMonitor?: StudioMachineMonitorStore;
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
  machineMonitor?: StudioMachineMonitorOptions | false;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
  sandboxes?: readonly StudioSandboxRegistration[];
  graphs: StudioGraphRegistration[];
};
