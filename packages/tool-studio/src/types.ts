import type { Agent, AgentResult, AgentStreamEvent, AgentSuspendedResult } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type {
  CompletionModel,
  CompletionModelCapabilities,
  JsonObject,
  JsonValue,
  Message,
  StreamingCompletionModel,
  ToolResultContentPart,
  Usage,
} from "@anvia/core/completion";
import type {
  MemoryAppendOptions,
  MemoryErrorOptions,
  MemoryScope,
  MemoryStore,
} from "@anvia/core/memory";
import type { ModelList } from "@anvia/core/model-listing";
import type { Pipeline, PipelineGraph } from "@anvia/core/pipeline";
import type { Hono } from "hono";

export type StudioCapability =
  | "agents"
  | "interactions"
  | "evals"
  | "memory"
  | "knowledge"
  | "mcps"
  | "observability"
  | "pipelines"
  | "sandboxes"
  | "sessions"
  | "status"
  | "tools"
  | "traces";

export type AgentTraceInfo = {
  observer: string;
  traceId?: string | undefined;
  observationId?: string | undefined;
};

export type AgentTraceOptions = {
  name?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  metadata?: JsonObject | undefined;
  tags?: string[] | undefined;
  version?: string | undefined;
  traceId?: string | undefined;
};

export type StudioModelRef = { providerId: string; modelId: string };

export type StudioModelModality = "text" | "image" | "document" | "audio" | "video";

export type StudioModelModalities = {
  input: StudioModelModality[];
  output?: StudioModelModality[];
};

export type StudioModelDefinition = {
  id: string;
  name?: string;
  description?: string;
  modalities?: StudioModelModalities;
  capabilities?: Partial<CompletionModelCapabilities>;
  metadata?: JsonObject;
};

export type StudioModelProvider = {
  id: string;
  name?: string;
  defaultModelId?: string;
  models?: StudioModelDefinition[];
  createCompletionModel(options: { modelId: string }): CompletionModel | StreamingCompletionModel;
  listModels?: (options?: { abortSignal?: AbortSignal | undefined }) => Promise<ModelList>;
  metadata?: JsonObject;
};

export type StudioAgentModelPolicy = {
  defaultModelRef?: StudioModelRef;
  allowed?: Array<StudioModelRef | `${string}:*`>;
};

export type StudioModelConfig = {
  providers: StudioModelProvider[];
  defaultModelRef?: StudioModelRef;
  agents?: Record<string, StudioAgentModelPolicy>;
};

export type StudioModelSummary = StudioModelDefinition & {
  ref: string;
  providerId: string;
  providerName?: string;
};

export type StudioModelProviderConfig = {
  id: string;
  name?: string;
  defaultModelId?: string;
  models: StudioModelSummary[];
  metadata?: JsonObject;
  warning?: string;
};

export type StudioAgentModelPolicyConfig = {
  defaultModelRef?: string;
  allowed?: string[];
};

export type StudioModelsConfig = {
  providers: StudioModelProviderConfig[];
  defaultModelRef?: string;
  agents: Record<string, StudioAgentModelPolicyConfig>;
};

export type StudioAgentModelsSummary = {
  agentId: string;
  defaultModelRef?: string;
  models: StudioModelSummary[];
  warnings?: JsonObject[];
};

export type StudioAgent = {
  id: string;
  agent: Agent;
  name?: string;
  description?: string;
  quickPrompts?: string[];
  metadata?: JsonObject;
};

// Studio accepts arbitrary pipelines and validates run inputs at the HTTP boundary.
// biome-ignore lint/suspicious/noExplicitAny: input/output types remain user-defined outside Studio.
export type StudioTarget = Agent | Pipeline<any, any>;

export type StudioAgentConfig = {
  id: string;
  name?: string;
  description?: string;
  quickPrompts: string[];
  metadata?: JsonObject;
};

export type StudioAgentRuntimeSummary = {
  id: string;
  name?: string;
  description?: string;
  model?: JsonValue;
  toolCount: number;
  staticToolCount: number;
  dynamicToolCount: number;
  approvalToolCount: number;
  mcpToolCount: number;
  staticContextCount: number;
  dynamicContextCount: number;
  observerCount: number;
  hasMemory: boolean;
  hasLifecycle: boolean;
  hasOutputSchema: boolean;
  defaultMaxTurns?: number;
  metadata?: JsonObject;
};

export type StudioPipeline = {
  id: string;
  // biome-ignore lint/suspicious/noExplicitAny: Studio stores heterogeneous user pipelines.
  pipeline: Pipeline<any, any>;
  name?: string;
  description?: string;
  metadata?: JsonObject;
};

export type StudioPipelineConfig = {
  id: string;
  name?: string;
  description?: string;
  metadata?: JsonObject;
  stageCount: number;
  edgeCount: number;
  hasParallelStages: boolean;
  agentCount: number;
  extractorCount: number;
};

export type StudioPipelineDetail = StudioPipelineConfig & {
  graph: PipelineGraph;
};

export type StudioEvalSuite<
  // biome-ignore lint/suspicious/noExplicitAny: Studio accepts heterogeneous eval suites.
  Input = any,
  // biome-ignore lint/suspicious/noExplicitAny: Studio accepts heterogeneous eval suites.
  _Output = any,
  // biome-ignore lint/suspicious/noExplicitAny: Studio accepts heterogeneous eval suites.
  _Expected = any,
> = {
  name: string;
  cases: Array<Input>;
  // biome-ignore lint/suspicious/noExplicitAny: Studio passes eval targets through to core.
  target: any;
  // biome-ignore lint/suspicious/noExplicitAny: Studio only reads metric names and passes metrics through.
  metrics: any[];
  concurrency?: number;
  // biome-ignore lint/suspicious/noExplicitAny: Studio passes reporters through to core.
  reporters?: any[];
  reporterErrorPolicy?: "collect" | "throw";
  id?: string;
  description?: string;
  metadata?: JsonObject;
};

export type StudioEvalSuiteConfig = {
  id: string;
  name: string;
  description?: string;
  caseCount: number;
  metricNames: string[];
  casePreviewCount?: number;
  casePreviews?: StudioEvalCasePreview[];
  metricSummaries?: StudioEvalMetricSummary[];
  concurrency?: number;
  metadata?: JsonObject;
};

export type StudioEvalCasePreview = {
  id: string;
  input?: JsonValue;
  expected?: JsonValue;
  metadataKeys?: string[];
};

export type StudioEvalMetricSummary = {
  name: string;
  required?: boolean;
  direction?: "higher_is_better" | "lower_is_better";
  threshold?: number;
  dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
  configId?: string;
  scoreConfigId?: string;
  metadataKeys?: string[];
};

export type StudioEvalRunRequest = {
  concurrency?: number;
};

export type StudioEvalRunResponse = {
  runId: string;
  suiteId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  result: JsonObject;
};

export type StudioCapabilityConfig = {
  enabled: boolean;
  reason?: string;
};

export type StudioConfig = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  agents: StudioAgentConfig[];
  models?: StudioModelsConfig;
  pipelines: StudioPipelineConfig[];
  evals: StudioEvalSuiteConfig[];
  chat: {
    quickPrompts: Record<string, string[]>;
  };
  capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>>;
  unsupportedCapabilities: StudioCapability[];
};

export type StudioAgentToolSource = "static" | "dynamic";

export type StudioAgentToolApprovalMetadata = {
  required: boolean;
  reason?: string;
  rejectMessage?: string;
};

export type StudioAgentToolMetadata = {
  agentId: string;
  name: string;
  description: string;
  parameters: JsonObject;
  source: StudioAgentToolSource;
  mcpServerName?: string;
  approval: StudioAgentToolApprovalMetadata;
};

export type StudioAgentToolsSummary = {
  agentId: string;
  tools: StudioAgentToolMetadata[];
};

export type StudioSandboxCapabilities = {
  files: boolean;
  ports: boolean;
  processes: boolean;
  views: boolean;
};

export type StudioSandboxInspectorFileEntry = Readonly<{
  path: string;
  type: StudioSandboxFileType;
  size?: number;
}>;

export type StudioSandboxInspectorPort = Readonly<{
  containerPort: number;
  host: string;
  hostPort: number;
  protocol: string;
}>;

export type StudioSandboxInspectorProcess = Readonly<{
  id: string;
  command: string;
  args: readonly string[];
  cwd?: string;
  status: StudioSandboxProcessStatus;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
}>;

export type StudioSandboxInspector = Readonly<{
  id: string;
  provider: string;
  workdir: string;
  listFiles?: (
    options?: Readonly<{ path?: string; abortSignal?: AbortSignal }>,
  ) => Promise<readonly StudioSandboxInspectorFileEntry[]>;
  readFile?: (
    options: Readonly<{ path: string; abortSignal?: AbortSignal }>,
  ) => Promise<Uint8Array>;
  publishedPorts?: readonly StudioSandboxInspectorPort[];
  listProcesses?: (
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => Promise<readonly StudioSandboxInspectorProcess[]>;
  readProcessLogs?: (
    options: Readonly<{ processId: string; tailBytes?: number; abortSignal?: AbortSignal }>,
  ) => Promise<StudioSandboxInspectorProcessLogs>;
}>;

export type StudioSandboxInspectorProcessLogs = Readonly<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type StudioSandboxViewControlSnapshot = Readonly<{
  mode: "agent" | "human";
  ownerId?: string;
  expiresAt?: string;
}>;

export type StudioSandboxViewControlLease = Readonly<{
  id: string;
  ownerId: string;
  expiresAt: string;
  renew(options: Readonly<{ leaseTimeoutMs: number }>): StudioSandboxViewControlSnapshot;
  release(): void;
}>;

export type StudioSandboxViewControl = Readonly<{
  snapshot(): StudioSandboxViewControlSnapshot;
  acquireHumanControl(
    options: Readonly<{
      ownerId: string;
      leaseTimeoutMs: number;
      abortSignal?: AbortSignal;
    }>,
  ): Promise<StudioSandboxViewControlLease>;
}>;

export type StudioSandboxViewSource = Readonly<{
  protocol: "novnc";
  containerPort: number;
  control: StudioSandboxViewControl;
}>;

export type StudioSandboxViewAuthorizeArgs = Readonly<{
  request: Request;
  sandboxRef: string;
  viewId: string;
}>;

export type StudioSandboxViewAccess =
  | Readonly<{ mode: "local" }>
  | Readonly<{
      mode: "authorize";
      authorize(args: StudioSandboxViewAuthorizeArgs): boolean | Promise<boolean>;
    }>;

export type StudioSandboxViewAuthentication =
  | Readonly<{ type: "none" }>
  | Readonly<{ type: "password"; password: string }>;

export type StudioSandboxViewRegistration = Readonly<{
  id: string;
  label: string;
  source: StudioSandboxViewSource;
  access: StudioSandboxViewAccess;
  authentication: StudioSandboxViewAuthentication;
}>;

export type StudioSandboxRegistration = Readonly<{
  inspector: StudioSandboxInspector;
  agentIds?: readonly string[];
  toolNames?: readonly string[];
  views?: readonly StudioSandboxViewRegistration[];
}>;

export type StudioSandboxViewSummary = {
  id: string;
  label: string;
  protocol: "novnc";
};

export type StudioSandboxViewConnection = {
  sandboxRef: string;
  viewId: string;
  protocol: "novnc";
  websocketPath: string;
  authentication: StudioSandboxViewAuthentication;
};

export type StudioSandboxSummary = {
  ref: string;
  id: string;
  provider: string;
  workdir: string;
  agentIds: string[];
  toolNames: string[];
  views: StudioSandboxViewSummary[];
  capabilities: StudioSandboxCapabilities;
};

export type StudioSandboxesSummary = {
  sandboxes: StudioSandboxSummary[];
};

export type StudioSandboxFileType = "file" | "directory" | "symlink" | "other";

export type StudioSandboxFileEntry = {
  path: string;
  type: StudioSandboxFileType;
  size?: number;
};

export type StudioSandboxFilesResponse = {
  sandboxRef: string;
  path: string;
  entries: StudioSandboxFileEntry[];
};

export type StudioSandboxPort = {
  containerPort: number;
  host: string;
  hostPort: number;
  protocol: string;
};

export type StudioSandboxPortsResponse = {
  sandboxRef: string;
  ports: StudioSandboxPort[];
};

export type StudioSandboxProcessStatus = "running" | "exited" | "stopped";

export type StudioSandboxProcess = {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  status: StudioSandboxProcessStatus;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
};

export type StudioSandboxProcessesResponse = {
  sandboxRef: string;
  processes: StudioSandboxProcess[];
};

export type StudioSandboxProcessLogsResponse = {
  sandboxRef: string;
  processId: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export type StudioToolRunRequest = {
  args: JsonValue;
  context?: JsonObject;
};

export type StudioToolRunResponse = {
  agentId: string;
  toolName: string;
  result?: JsonValue;
  error?: JsonValue;
  status: "success" | "error";
  durationMs: number;
  startedAt: string;
  endedAt: string;
  events: JsonValue[];
};

export type StudioAgentMcpToolMetadata = {
  name: string;
  description: string;
  parameters: JsonObject;
  source: StudioAgentToolSource;
  approval: StudioAgentToolApprovalMetadata;
};

export type StudioAgentMcpServerMetadata = {
  agentId: string;
  name: string;
  toolCount: number;
  tools: StudioAgentMcpToolMetadata[];
};

export type StudioAgentMcpsSummary = {
  agentId: string;
  servers: StudioAgentMcpServerMetadata[];
};

export type StudioTranscriptChatEntry = {
  entryId: number;
  kind: "message";
  role: "user" | "assistant";
  text: string;
  tone?: "error";
  traceId?: string;
  durationMs?: number;
  attachments?: StudioTranscriptAttachment[];
};

export type StudioTranscriptAttachment = {
  kind: "image" | "document";
  name?: string;
  mediaType?: string;
  data?: string;
  url?: string;
};

export type StudioTranscriptReasoningEntry = {
  entryId: number;
  kind: "reasoning";
  reasoningId?: string;
  text: string;
};

export type StudioTranscriptToolEntry = {
  entryId: number;
  kind: "tool";
  toolName: string;
  callId?: string;
  args?: string;
  result?: string;
  structuredResult?: readonly ToolResultContentPart[];
  childEvents?: StudioTranscriptChildAgentEvent[];
  approval?: StudioToolApprovalTranscript;
  question?: StudioToolQuestionTranscript;
};

export type StudioTranscriptChildAgentEvent =
  | {
      kind: "message";
      agentId: string;
      agentName?: string;
      text: string;
    }
  | {
      kind: "reasoning";
      agentId: string;
      agentName?: string;
      reasoningId?: string;
      text: string;
    }
  | {
      kind: "tool";
      agentId: string;
      agentName?: string;
      toolName: string;
      callId?: string;
      args?: string;
      result?: string;
      structuredResult?: readonly ToolResultContentPart[];
    };

export type StudioTranscriptEntry =
  | StudioTranscriptChatEntry
  | StudioTranscriptReasoningEntry
  | StudioTranscriptToolEntry;

export type StudioSessionSummary = {
  id: string;
  agentId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: JsonObject;
};

export type StudioSession = StudioSessionSummary & {
  messages: Message[];
  transcript: StudioTranscriptEntry[];
};

export type StudioSessionCreateInput = {
  id: string;
  agentId: string;
  title?: string;
  metadata?: JsonObject;
};

export type StudioSessionListOptions = {
  agentId?: string;
  limit: number;
};

export type StudioSessionRunStatus = "running" | "success" | "suspended" | "error" | "cancelled";

export type StudioSessionRunTranscriptInput = {
  id: string;
  runId: string;
  title?: string;
  transcript: StudioTranscriptEntry[];
  status: StudioSessionRunStatus;
  error?: JsonValue;
};

export type StudioSessionLogLevel = "debug" | "info" | "warn" | "error";

export type StudioSessionLogCategory =
  | "session"
  | "run"
  | "memory"
  | "prompt"
  | "model"
  | "tool"
  | "approval"
  | "question"
  | "api";

export type StudioSessionLogEntry = {
  id: string;
  sessionId: string;
  runId?: string;
  sequence: number;
  timestamp: string;
  level: StudioSessionLogLevel;
  category: StudioSessionLogCategory;
  event: string;
  message: string;
  metadata?: JsonObject;
};

export type StudioSessionLogAppendInput = {
  sessionId: string;
  runId?: string;
  level: StudioSessionLogLevel;
  category: StudioSessionLogCategory;
  event: string;
  message: string;
  metadata?: JsonObject;
};

export type StudioSessionLogListOptions = {
  sessionId: string;
  limit: number;
  after?: number;
};

export type StudioMemoryScope = MemoryScope;
export type StudioMemoryAppendOptions = MemoryAppendOptions;
export type StudioMemoryErrorOptions = MemoryErrorOptions;
export type StudioMemoryStore = MemoryStore;

export type StudioSessionStore = StudioMemoryStore & {
  readonly kind?: string;
  listSessions(
    options: StudioSessionListOptions,
  ): StudioSessionSummary[] | Promise<StudioSessionSummary[]>;
  createSession(
    input: StudioSessionCreateInput,
  ): StudioSessionSummary | Promise<StudioSessionSummary>;
  getSession(id: string): StudioSession | undefined | Promise<StudioSession | undefined>;
  saveSessionRunTranscript(
    input: StudioSessionRunTranscriptInput,
  ): StudioSession | undefined | Promise<StudioSession | undefined>;
  updateSessionMetadata?(
    id: string,
    metadata: JsonObject | undefined,
  ): StudioSession | undefined | Promise<StudioSession | undefined>;
  appendSessionLog?(
    input: StudioSessionLogAppendInput,
  ): StudioSessionLogEntry | Promise<StudioSessionLogEntry>;
  listSessionLogs?(
    options: StudioSessionLogListOptions,
  ): StudioSessionLogEntry[] | Promise<StudioSessionLogEntry[]>;
  deleteSession?(id: string): boolean | Promise<boolean>;
};

export type StudioTraceStatus = "running" | "success" | "suspended" | "error";

export type StudioTraceObservationKind = "agent" | "generation" | "tool";

export type StudioTraceObservation = {
  id: string;
  parentObservationId?: string;
  kind: StudioTraceObservationKind;
  name: string;
  status: StudioTraceStatus;
  turn: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  metadata?: JsonObject;
};

export type StudioTraceSummary = {
  id: string;
  runId?: string;
  sessionId: string;
  name?: string;
  status: StudioTraceStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  output?: string;
  error?: JsonValue;
  usage?: Usage;
  metadata?: JsonObject;
  observationCount: number;
};

export type StudioTrace = StudioTraceSummary & {
  trace?: AgentTraceInfo;
  input?: JsonValue;
  observations: StudioTraceObservation[];
};

export type StudioObservabilityEventType = "session_log" | "pipeline_log" | "trace";

export type StudioObservabilityEvent =
  | {
      type: "session_log";
      log: StudioSessionLogEntry;
    }
  | {
      type: "pipeline_log";
      log: StudioPipelineLogEntry;
    }
  | {
      type: "trace";
      trace: StudioTraceSummary;
    };

export type StudioTraceListOptions = {
  limit: number;
  agentId?: string;
  sessionId?: string;
  status?: StudioTraceStatus;
};

export type StudioSessionTraceListOptions = {
  sessionId: string;
  limit: number;
};

export type StudioTraceStore = {
  readonly kind?: string;
  listTraces?(
    options: StudioTraceListOptions,
  ): StudioTraceSummary[] | Promise<StudioTraceSummary[]>;
  listSessionTraces(
    options: StudioSessionTraceListOptions,
  ): StudioTraceSummary[] | Promise<StudioTraceSummary[]>;
  getTrace(id: string): StudioTrace | undefined | Promise<StudioTrace | undefined>;
  saveTrace(trace: StudioTrace): StudioTrace | Promise<StudioTrace>;
};

export type StudioKnowledgeSourceKind = "static_context" | "dynamic_context" | "dynamic_tools";

export type StudioKnowledgeSourceSummary = {
  sourceId?: string;
  kind: StudioKnowledgeSourceKind;
  label?: string;
  count: number;
  registrationIndex?: number;
  topK?: number;
  minScore?: number;
  inspectable?: boolean;
  itemCount?: number;
};

export type StudioStaticKnowledgeDocument = {
  id: string;
  text: string;
  additionalProps?: JsonObject;
};

export type StudioKnowledgeEvidenceDocument = {
  id?: string;
  text?: string;
  additionalProps?: JsonObject;
};

export type StudioKnowledgeEvidence = {
  traceId: string;
  sessionId: string;
  observationId: string;
  observationName: string;
  turn: number;
  startedAt: string;
  query?: string;
  documentCount: number;
  toolCount: number;
  documents: StudioKnowledgeEvidenceDocument[];
  tools: string[];
};

export type StudioAgentKnowledgeConfig = {
  agentId: string;
  agentName?: string;
  sources: StudioKnowledgeSourceSummary[];
  staticContext: StudioStaticKnowledgeDocument[];
};

export type StudioKnowledgeItemKind = "static_context" | "dynamic_context" | "dynamic_tool";

export type StudioKnowledgeItem = {
  id: string;
  kind: StudioKnowledgeItemKind;
  text?: string;
  document?: JsonValue;
  toolName?: string;
  description?: string;
  parameterKeys?: string[];
  metadata?: JsonObject;
};

export type StudioKnowledgeItemsPage = {
  agentId: string;
  sourceId: string;
  kind: StudioKnowledgeSourceKind;
  inspectable: boolean;
  items: StudioKnowledgeItem[];
  nextCursor?: string;
  totalCount?: number;
  message?: string;
};

export type StudioKnowledgeSummary = {
  agents: StudioAgentKnowledgeConfig[];
  evidence: StudioKnowledgeEvidence[];
};

export type StudioMemoryUserSummary = {
  userId: string;
  conversationCount: number;
  agentIds: string[];
  lastInteractionAt: string;
};

export type StudioMemoryConversationSummary = {
  id: string;
  userId: string;
  agentId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: JsonObject;
};

export type StudioMemoryConversationsPage = {
  conversations: StudioMemoryConversationSummary[];
  total: number;
};

export type StudioMemoryUsersPage = {
  users: StudioMemoryUserSummary[];
  total: number;
};

export type StudioMemoryConversationMessages = {
  conversation: StudioMemoryConversationSummary;
  messages: Message[];
  transcript: StudioTranscriptEntry[];
};

export type StudioMemoryConversationSteps = {
  conversation: StudioMemoryConversationSummary;
  steps: StudioTranscriptEntry[];
};

export type StudioMemorySourceKind = "agent" | "studio";

export type StudioMemorySourceSummary = {
  ref: string;
  kind: StudioMemorySourceKind;
  label: string;
  agentIds: string[];
  available: boolean;
  storeKind?: string;
  reason?: string;
};

export type StudioMemorySourcesPage = {
  sources: StudioMemorySourceSummary[];
};

export type StudioMemorySourceConversationSummary = {
  ref: string;
  sessionId: string;
  userId: string;
  agentIds: string[];
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: JsonObject;
};

export type StudioMemorySourceConversationsPage = {
  source: StudioMemorySourceSummary;
  conversations: StudioMemorySourceConversationSummary[];
  total: number;
};

export type StudioMemorySourceUsersPage = {
  source: StudioMemorySourceSummary;
  users: StudioMemoryUserSummary[];
  total: number;
};

export type StudioMemoryMessageRecord = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string;
  message: Message;
};

export type StudioMemorySourceConversationMessages = {
  source: StudioMemorySourceSummary;
  conversation: StudioMemorySourceConversationSummary;
  messages: Message[];
  records: StudioMemoryMessageRecord[];
  transcript: StudioTranscriptEntry[];
};

export type StudioMemorySourceConversationSteps = {
  source: StudioMemorySourceSummary;
  conversation: StudioMemorySourceConversationSummary;
  steps: StudioTranscriptEntry[];
};

export type StudioStatusSummary = {
  runner: {
    id: string;
    name?: string;
    version?: string;
  };
  storage: {
    sessions?: string;
    traces?: string;
    pipelineLogs?: string;
    pipelineRuns?: string;
  };
  counts: {
    agents: number;
    pipelines: number;
    sandboxes?: number;
    sessions?: number;
    traces?: number;
    pipelineRuns?: number;
  };
  capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>>;
  generatedAt: string;
};

export type StudioStores = {
  sessions?: StudioSessionStore | false;
  traces?: StudioTraceStore;
  pipelineLogs?: StudioPipelineLogStore | false;
  pipelineRuns?: StudioPipelineRunStore | false;
};

export type StudioUiOptions = {
  path?: string;
  rootRoutes?: boolean;
  title?: string;
  redirectRoot?: boolean;
  clientScript?: string;
  protectShell?: boolean;
};

export type StudioOptions = {
  // biome-ignore lint/suspicious/noExplicitAny: Studio accepts eval suites with arbitrary user-defined case and output types.
  evals?: Array<StudioEvalSuite<any, any, any>>;
  quickPrompts?: Record<string, string[]>;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
  models?: StudioModelConfig;
  sandboxes?: readonly StudioSandboxRegistration[];
};

export type StudioServeOptions = {
  port?: number;
  hostname?: string;
  log?: boolean;
  handleSignals?: boolean;
};

export type StudioServeLifecycleOptions = Omit<StudioServeOptions, "handleSignals"> & {
  signal?: AbortSignal;
  onShutdown?: () => void | Promise<void>;
};

export type StudioToolApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "timed_out"
  | "cancelled";

export type StudioToolApprovalTranscript = {
  id: string;
  status: StudioToolApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  reason?: string;
};

export type StudioToolQuestionChoice = {
  label: string;
  value: string;
};

export type StudioToolQuestionPrompt = {
  id: string;
  question: string;
  choices: StudioToolQuestionChoice[];
  allowCustom: boolean;
};

export type StudioToolQuestionAnswer = {
  questionId: string;
  answer: string;
  choice?: string;
  custom?: boolean;
};

export type StudioToolQuestionStatus = "pending" | "answered" | "cancelled";

export type StudioToolQuestionTranscript = {
  id: string;
  status: StudioToolQuestionStatus;
  requestedAt: string;
  answeredAt?: string;
  cancelledAt?: string;
  questions: StudioToolQuestionPrompt[];
  answers?: StudioToolQuestionAnswer[];
};

export type StudioSessionLogEvent = {
  type: "session_log";
  log: StudioSessionLogEntry;
};

export type StudioPipelineLogLevel = "debug" | "info" | "warn" | "error";

export type StudioPipelineLogCategory =
  | "pipeline"
  | "run"
  | "stage"
  | "parallel"
  | "agent"
  | "extractor"
  | "api";

export type StudioPipelineLogEntry = {
  id: string;
  pipelineId: string;
  runId?: string;
  sequence: number;
  timestamp: string;
  level: StudioPipelineLogLevel;
  category: StudioPipelineLogCategory;
  event: string;
  message: string;
  metadata?: JsonObject;
};

export type StudioPipelineLogAppendInput = {
  pipelineId: string;
  runId?: string;
  level: StudioPipelineLogLevel;
  category: StudioPipelineLogCategory;
  event: string;
  message: string;
  metadata?: JsonObject;
};

export type StudioPipelineLogListOptions = {
  pipelineId: string;
  limit: number;
  after?: number;
};

export type StudioPipelineLogStore = {
  appendPipelineLog(
    input: StudioPipelineLogAppendInput,
  ): StudioPipelineLogEntry | Promise<StudioPipelineLogEntry>;
  listPipelineLogs(
    options: StudioPipelineLogListOptions,
  ): StudioPipelineLogEntry[] | Promise<StudioPipelineLogEntry[]>;
};

export type StudioPipelineLogEvent = {
  type: "pipeline_log";
  log: StudioPipelineLogEntry;
};

export type StudioPipelineFinalEvent = {
  type: "pipeline_final";
  runId: string;
  pipelineId: string;
  output: JsonValue;
};

export type StudioPipelineRunStatus = "running" | "success" | "error";

export type StudioPipelineRunRecord = {
  runId: string;
  pipelineId: string;
  status: StudioPipelineRunStatus;
  input: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  metadata?: JsonObject;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};

export type StudioPipelineRunSaveInput = {
  runId: string;
  pipelineId: string;
  status: StudioPipelineRunStatus;
  input: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  metadata?: JsonObject;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};

export type StudioPipelineRunListOptions = {
  pipelineId: string;
  limit: number;
};

export type StudioPipelineRunGetOptions = {
  pipelineId: string;
  runId: string;
};

export type StudioPipelineRunStore = {
  savePipelineRun(
    input: StudioPipelineRunSaveInput,
  ): StudioPipelineRunRecord | Promise<StudioPipelineRunRecord>;
  getPipelineRun(
    options: StudioPipelineRunGetOptions,
  ): StudioPipelineRunRecord | undefined | Promise<StudioPipelineRunRecord | undefined>;
  listPipelineRuns(
    options: StudioPipelineRunListOptions,
  ): StudioPipelineRunRecord[] | Promise<StudioPipelineRunRecord[]>;
};

export type StudioPipelineRunRequest = {
  input: JsonValue;
  stream?: boolean;
  metadata?: JsonObject;
};

export type StudioPipelineReplayRequest = {
  stream?: boolean;
  metadata?: JsonObject;
};

export type StudioPipelineRunResponse = {
  runId: string;
  pipelineId: string;
  output: JsonValue;
};

type AgentRunRequestBase = {
  stream?: boolean;
  metadata?: JsonObject;
  trace?: AgentTraceOptions;
};

export type AgentRunRequest =
  | (AgentRunRequestBase & {
      type: "messages";
      messages: readonly Message[];
      sessionId?: string;
      maxTurns?: number;
      toolConcurrency?: number;
      model?: StudioModelRef;
      interactionId?: never;
      response?: never;
    })
  | (AgentRunRequestBase & {
      type: "interaction_response";
      interactionId: string;
      response: AgentInteractionResponse;
      messages?: never;
      sessionId?: never;
      maxTurns?: never;
      toolConcurrency?: never;
      model?: never;
    });

export type AgentRunResponse =
  | Exclude<AgentResult, AgentSuspendedResult>
  | Omit<AgentSuspendedResult, "continuation" | "messages">;

export type AgentRunStreamEvent =
  | AgentStreamEvent
  | StudioSessionLogEvent
  | StudioPipelineLogEvent
  | StudioPipelineFinalEvent;

export type StudioErrorCode =
  | "bad_request"
  | "conflict"
  | "forbidden"
  | "not_found"
  | "payload_too_large"
  | "unsupported_capability"
  | "internal_error";

export type StudioErrorResponse = {
  error: {
    code: StudioErrorCode;
    message: string;
    details?: JsonValue;
  };
};

export { traceSummary } from "./runtime/trace-summary";

export type AnviaStudio = {
  readonly app: Hono;
  fetch(request: Request): Response | Promise<Response>;
  config(): StudioConfig;
  close(): void;
};
