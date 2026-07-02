---
title: "Studio Types"
description: "Studio config, agent config, capabilities, and error response contracts."
section: packages
sidebar:
  group: "Reference"
  order: 7
  label: "Studio Types"
---
Import from `@anvia/studio`.

## Config Types

```ts
type StudioCapability =
  | "agents"
  | "approvals"
  | "knowledge"
  | "memory"
  | "mcps"
  | "observability"
  | "pipelines"
  | "sessions"
  | "status"
  | "tools"
  | "traces";

type StudioAgent = {
  id: string;
  agent: Agent;
  name?: string;
  description?: string;
  quickPrompts?: string[];
  metadata?: JsonObject;
};

type StudioAgentConfig = {
  id: string;
  name?: string;
  description?: string;
  quickPrompts: string[];
  metadata?: JsonObject;
};

type StudioAgentRuntimeSummary = {
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
  hasHook: boolean;
  hasOutputSchema: boolean;
  defaultMaxTurns?: number;
  metadata?: JsonObject;
};

type StudioTarget = Agent | Pipeline<unknown, unknown>;

type StudioPipeline = {
  id: string;
  pipeline: Pipeline<unknown, unknown>;
  name?: string;
  description?: string;
  metadata?: JsonObject;
};

type StudioPipelineConfig = {
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

type StudioPipelineDetail = StudioPipelineConfig & {
  graph: PipelineGraph;
};

type StudioCapabilityConfig = {
  enabled: boolean;
  reason?: string;
};

type StudioConfig = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  agents: StudioAgentConfig[];
  models?: StudioModelsConfig;
  pipelines: StudioPipelineConfig[];
  evals: StudioEvalSuiteConfig[];
  chat: { quickPrompts: Record<string, string[]> };
  capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>>;
  unsupportedCapabilities: StudioCapability[];
};
```

Purpose: configuration returned by Studio runtime and HTTP config endpoints.

Return behavior: `Studio.config()` returns `StudioConfig`. Pipelines are top-level Studio targets beside agents.

Notable errors: none directly.

## Model Configuration Types

```ts
type StudioModelRef = string | { provider: string; model: string };

type StudioModelModality = "text" | "image" | "document" | "audio" | "video";

type StudioModelModalities = {
  input: StudioModelModality[];
  output?: StudioModelModality[];
};

type StudioModelDefinition = {
  id: string;
  name?: string;
  description?: string;
  modalities?: StudioModelModalities;
  capabilities?: Partial<CompletionModelCapabilities>;
  metadata?: JsonObject;
};

type StudioModelProvider = {
  id: string;
  name?: string;
  defaultModel?: string;
  models?: StudioModelDefinition[];
  createCompletionModel(model: string): CompletionModel | StreamingCompletionModel;
  listModels?: () => Promise<ModelList>;
  metadata?: JsonObject;
};

type StudioAgentModelPolicy = {
  default?: StudioModelRef;
  allowed?: Array<StudioModelRef | `${string}:*`>;
};

type StudioModelConfig = {
  providers: StudioModelProvider[];
  default?: StudioModelRef;
  agents?: Record<string, StudioAgentModelPolicy>;
};

type StudioModelSummary = StudioModelDefinition & {
  ref: string;
  providerId: string;
  providerName?: string;
};

type StudioModelProviderConfig = {
  id: string;
  name?: string;
  defaultModel?: string;
  models: StudioModelSummary[];
  metadata?: JsonObject;
  warning?: string;
};

type StudioAgentModelPolicyConfig = {
  default?: string;
  allowed?: string[];
};

type StudioModelsConfig = {
  providers: StudioModelProviderConfig[];
  default?: string;
  agents: Record<string, StudioAgentModelPolicyConfig>;
};

type StudioAgentModelsSummary = {
  agentId: string;
  defaultModel?: string;
  models: StudioModelSummary[];
  warnings?: JsonObject[];
};
```

Purpose: configure the provider/model menu Studio exposes for agent runs. `StudioModelProvider` bridges human-facing model metadata to runtime `CompletionModel` instances. `StudioModelModalities` records whether a model accepts text, image, document, audio, or video input and which output modalities it can produce.

Return behavior: `StudioModelConfig` is accepted through `new Studio(targets, { models })`. `StudioModelsConfig` appears on `GET /config`; `StudioAgentModelsSummary` appears on `GET /agents/:agentId/models`; `StudioModelSummary` values use canonical `provider:model` refs for UI selection and HTTP run requests.

Notable errors: run requests that select a model outside an agent's `StudioAgentModelPolicy` return `bad_request`. Unsupported modality selections are reported as warnings when metadata is available.

## Tool Metadata Types

```ts
type StudioAgentToolSource = "static" | "dynamic";

type StudioAgentToolApprovalMetadata = {
  required: boolean;
  reason?: string;
  rejectMessage?: string;
};

type StudioAgentToolMetadata = {
  agentId: string;
  name: string;
  description: string;
  parameters: JsonObject;
  source: StudioAgentToolSource;
  mcpServerName?: string;
  approval: StudioAgentToolApprovalMetadata;
};

type StudioAgentToolsSummary = {
  agentId: string;
  tools: StudioAgentToolMetadata[];
};

type StudioToolRunRequest = {
  args: JsonValue;
  context?: JsonObject;
};

type StudioToolRunResponse = {
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

type StudioAgentMcpToolMetadata = {
  name: string;
  description: string;
  parameters: JsonObject;
  source: StudioAgentToolSource;
  approval: StudioAgentToolApprovalMetadata;
};

type StudioAgentMcpServerMetadata = {
  agentId: string;
  name: string;
  toolCount: number;
  tools: StudioAgentMcpToolMetadata[];
};

type StudioAgentMcpsSummary = {
  agentId: string;
  servers: StudioAgentMcpServerMetadata[];
};

type StudioTranscriptAttachment = {
  kind: "image" | "document";
  name?: string;
  mediaType?: string;
  data?: string;
  url?: string;
};
```

Purpose: metadata returned by `GET /agents/:agentId/tools` and used by the Studio Tools inspector.

Return behavior: static tools come from `agent.toolSet`; dynamic tools are listed when the dynamic tool index exposes its underlying `ToolSet`. MCP tools registered through `.mcp(...)` are normal runnable tools and include `mcpServerName` in `GET /agents/:agentId/tools`. Direct tool runs use `POST /agents/:agentId/tools/:toolName/runs`.

Notable errors: unknown agents return `not_found`.

`GET /agents/:agentId/mcps` returns the MCP subset grouped by server name. MCP metadata is available for tools registered through `.mcp(...)` and includes the same tool approval metadata used by the Tools inspector.

## Memory and Status Types

```ts
type StudioMemoryUserSummary = {
  userId: string;
  conversationCount: number;
  agentIds: string[];
  lastInteractionAt: string;
};

type StudioMemoryConversationSummary = {
  id: string;
  userId: string;
  agentId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: JsonObject;
};

type StudioMemoryConversationsPage = {
  conversations: StudioMemoryConversationSummary[];
  total: number;
};

type StudioMemoryUsersPage = {
  users: StudioMemoryUserSummary[];
  total: number;
};

type StudioMemoryConversationMessages = {
  conversation: StudioMemoryConversationSummary;
  messages: Message[];
  transcript: StudioTranscriptEntry[];
};

type StudioMemoryConversationSteps = {
  conversation: StudioMemoryConversationSummary;
  steps: StudioTranscriptEntry[];
};

type StudioStatusSummary = {
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
    sessions?: number;
    traces?: number;
    pipelineRuns?: number;
  };
  capabilities: Partial<Record<StudioCapability, StudioCapabilityConfig>>;
  generatedAt: string;
};

type StudioEvalSuite = RunEvalSuiteOptions<unknown, unknown, unknown> & {
  id?: string;
  description?: string;
  metadata?: JsonObject;
};

type StudioEvalSuiteConfig = {
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

type StudioEvalCasePreview = {
  id: string;
  input?: JsonValue;
  expected?: JsonValue;
  metadataKeys?: string[];
};

type StudioEvalMetricSummary = {
  name: string;
  dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
  configId?: string;
  scoreConfigId?: string;
  metadataKeys?: string[];
};

type StudioEvalRunRequest = {
  concurrency?: number;
};

type StudioEvalRunResponse = {
  runId: string;
  suiteId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  result: JsonObject;
};
```

Purpose: response contracts for Memory, Status, direct tool runs, eval runs, and richer agent runtime inspection routes.

Return behavior: Memory routes summarize the active Studio session store; Status returns a compact runtime snapshot.

Register eval suites with `new Studio(targets, { evals: [...] })`. Studio lists their case and metric counts, includes bounded case and metric previews for the UI, and runs them through `POST /evals/:evalId/runs`.

Notable errors: unsupported or missing stores return `unsupported_capability` or `not_found` from route handlers.

## Run Types

```ts
type AgentRunRequest = {
  message: string | Message;
  history?: Message[];
  sessionId?: string;
  model?: StudioModelRef;
  stream?: boolean;
  maxTurns?: number;
  toolConcurrency?: number;
  metadata?: JsonObject;
  trace?: AgentTraceOptions;
};

type AgentRunResponse = PromptResponse;

type AgentRunStreamEvent =
  | AgentStreamEvent
  | StudioToolApprovalRequestEvent
  | StudioToolApprovalResultEvent
  | StudioToolQuestionRequestEvent
  | StudioToolQuestionResultEvent
  | StudioSessionLogEvent
  | StudioPipelineLogEvent
  | StudioPipelineFinalEvent;

type StudioObservabilityEventType = "session_log" | "pipeline_log" | "trace";

type StudioObservabilityEvent =
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
```

Purpose: HTTP request and response contracts for Studio agent runs.

Return behavior: non-streaming agent runs return `AgentRunResponse`; streaming agent runs emit newline-delimited `AgentRunStreamEvent` values. `session_log` and `pipeline_log` events are Studio-owned metadata-only runtime logs.

`GET /observability/events` emits newline-delimited `StudioObservabilityEvent` values. Use the optional `type` query string to subscribe to `session_log`, `pipeline_log`, `trace`, or a comma-separated subset.

Notable errors: invalid run request bodies return `bad_request`; unsupported stores or capabilities return `unsupported_capability`.

## Pipeline Run Types

```ts
type StudioPipelineLogLevel = "debug" | "info" | "warn" | "error";

type StudioPipelineLogCategory =
  | "pipeline"
  | "run"
  | "stage"
  | "parallel"
  | "agent"
  | "extractor"
  | "api";

type StudioPipelineLogEntry = {
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

type StudioPipelineLogAppendInput = {
  pipelineId: string;
  runId?: string;
  level: StudioPipelineLogLevel;
  category: StudioPipelineLogCategory;
  event: string;
  message: string;
  metadata?: JsonObject;
};

type StudioPipelineLogListOptions = {
  pipelineId: string;
  limit: number;
  after?: number;
};

type StudioPipelineLogEvent = {
  type: "pipeline_log";
  log: StudioPipelineLogEntry;
};

type StudioPipelineFinalEvent = {
  type: "pipeline_final";
  runId: string;
  pipelineId: string;
  output: JsonValue;
};

type StudioPipelineRunRequest = {
  input: JsonValue;
  stream?: boolean;
  metadata?: JsonObject;
};

type StudioPipelineReplayRequest = {
  stream?: boolean;
  metadata?: JsonObject;
};

type StudioPipelineRunResponse = {
  runId: string;
  pipelineId: string;
  output: JsonValue;
};
```

Purpose: HTTP request, response, stream, and persisted log contracts for Studio pipeline runs.

Return behavior: non-streaming pipeline runs return `StudioPipelineRunResponse`; streaming runs emit `pipeline_log` events and one `pipeline_final` event.

Notable errors: Studio HTTP pipeline inputs must be JSON-compatible. Use direct `pipeline.run(...)` for non-JSON inputs.

## Knowledge Types

```ts
type StudioKnowledgeSourceKind = "static_context" | "dynamic_context" | "dynamic_tools";

type StudioKnowledgeSourceSummary = {
  kind: StudioKnowledgeSourceKind;
  count: number;
};

type StudioStaticKnowledgeDocument = {
  id: string;
  text: string;
  additionalProps?: JsonObject;
};

type StudioKnowledgeEvidenceDocument = {
  id?: string;
  text?: string;
  additionalProps?: JsonObject;
};

type StudioKnowledgeEvidence = {
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

type StudioAgentKnowledgeConfig = {
  agentId: string;
  agentName?: string;
  sources: StudioKnowledgeSourceSummary[];
  staticContext: StudioStaticKnowledgeDocument[];
};

type StudioKnowledgeItemKind = "static_context" | "dynamic_context" | "dynamic_tool";

type StudioKnowledgeItem = {
  id: string;
  kind: StudioKnowledgeItemKind;
  text?: string;
  document?: JsonValue;
  toolName?: string;
  description?: string;
  parameterKeys?: string[];
  metadata?: JsonObject;
};

type StudioKnowledgeItemsPage = {
  agentId: string;
  sourceId: string;
  kind: StudioKnowledgeSourceKind;
  inspectable: boolean;
  items: StudioKnowledgeItem[];
  nextCursor?: string;
  totalCount?: number;
  message?: string;
};

type StudioKnowledgeSummary = {
  agents: StudioAgentKnowledgeConfig[];
  evidence: StudioKnowledgeEvidence[];
};
```

Purpose: summarize each agent's inspectable static context, dynamic context, dynamic tools, and recent trace evidence.

Return behavior: `GET /knowledge` returns `StudioKnowledgeSummary`; source item routes return `StudioKnowledgeItemsPage`.

Notable errors: invalid `limit` query values return `bad_request`.

## Pipeline Run Persistence Types

```ts
type StudioPipelineRunStatus = "running" | "success" | "error";

type StudioPipelineRunRecord = {
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

type StudioPipelineRunSaveInput = {
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

type StudioPipelineRunListOptions = {
  pipelineId: string;
  limit: number;
};

type StudioPipelineRunGetOptions = {
  pipelineId: string;
  runId: string;
};

type StudioPipelineRunStore = {
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
```

Purpose: persistence contract for Studio pipeline run history.

Return behavior: stores normalize saved run input into `StudioPipelineRunRecord` values, load exact records by pipeline and run id, and list recent records per pipeline.

Notable errors: store failures surface through the Studio runtime or HTTP route handling the pipeline request.

## Error Types

```ts
type StudioErrorCode =
  | "bad_request"
  | "conflict"
  | "not_found"
  | "unsupported_capability"
  | "internal_error";

type StudioErrorResponse = {
  error: {
    code: StudioErrorCode;
    message: string;
    details?: JsonValue;
  };
};
```

Purpose: normalized Studio HTTP error shape.

Return behavior: returned by API routes on request or runtime failures.

Notable errors: `internal_error` responses serialize thrown errors into `details` when available.
