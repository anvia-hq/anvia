import type {
  CompletionModel,
  CompletionModelCapabilities,
  JsonObject,
  JsonValue,
  Message,
  StreamingCompletionModel,
  ToolResultContent,
  Usage,
} from "@anvia/core/completion";
import type { Agent } from "@anvia/core/internal/agent";
import type { ModelList } from "@anvia/core/model-listing";
import type { Pipeline, PipelineGraph } from "@anvia/core/pipeline";
import type { AgentStreamEvent, PromptResponse } from "@anvia/core/request";
import type { Hono } from "hono";
import { compact } from "./shared/compact";

export type StudioCapability =
  | "agents"
  | "approvals"
  | "evals"
  | "memory"
  | "knowledge"
  | "mcps"
  | "observability"
  | "pipelines"
  | "sessions"
  | "status"
  | "tools"
  | "traces";

export type AgentTraceInfo = {
  traceId?: string | undefined;
  observationId?: string | undefined;
};

export type AgentTraceOptions = {
  name?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  version?: string | undefined;
  traceId?: string | undefined;
  failOnObserverError?: boolean | undefined;
};

export type StudioModelRef = string | { provider: string; model: string };

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
  defaultModel?: string;
  models?: StudioModelDefinition[];
  createCompletionModel(model: string): CompletionModel | StreamingCompletionModel;
  listModels?: () => Promise<ModelList>;
  metadata?: JsonObject;
};

export type StudioAgentModelPolicy = {
  default?: StudioModelRef;
  allowed?: Array<StudioModelRef | `${string}:*`>;
};

export type StudioModelConfig = {
  providers: StudioModelProvider[];
  default?: StudioModelRef;
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
  defaultModel?: string;
  models: StudioModelSummary[];
  metadata?: JsonObject;
  warning?: string;
};

export type StudioAgentModelPolicyConfig = {
  default?: string;
  allowed?: string[];
};

export type StudioModelsConfig = {
  providers: StudioModelProviderConfig[];
  default?: string;
  agents: Record<string, StudioAgentModelPolicyConfig>;
};

export type StudioAgentModelsSummary = {
  agentId: string;
  defaultModel?: string;
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
  hasHook: boolean;
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
  failOnReporterError?: boolean;
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
  structuredResult?: ToolResultContent[];
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
      structuredResult?: ToolResultContent[];
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

export type StudioSessionRunStatus = "running" | "success" | "error";

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

export type StudioMemoryContext = {
  sessionId: string;
  userId?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type StudioMemoryAppendInput = {
  context: StudioMemoryContext;
  runId: string;
  turn: number;
  messages: Message[];
};

export type StudioMemoryErrorInput = {
  context: StudioMemoryContext;
  runId: string;
  error: unknown;
  messages: Message[];
};

export type StudioMemoryStore = {
  load(context: StudioMemoryContext): Promise<Message[]>;
  append(input: StudioMemoryAppendInput): Promise<void>;
  clear(context: StudioMemoryContext): Promise<void>;
  recordError?(input: StudioMemoryErrorInput): Promise<void>;
};

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

export type StudioTraceStatus = "running" | "success" | "error";

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
  threshold?: number;
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
};

export type StudioServeOptions = {
  port?: number;
  hostname?: string;
  log?: boolean;
};

export type StudioToolApprovalDecision = {
  approved: boolean;
  reason?: string;
};

export type StudioToolApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

export type StudioToolApproval = {
  id: string;
  runId: string;
  agentId: string;
  sessionId?: string;
  toolName: string;
  callId?: string;
  internalCallId: string;
  args: string;
  status: StudioToolApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  reason?: string;
};

export type StudioToolApprovalTranscript = {
  id: string;
  status: StudioToolApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  reason?: string;
};

export type StudioToolApprovalRequestEvent = {
  type: "tool_approval_request";
  approval: StudioToolApproval;
};

export type StudioToolApprovalResultEvent = {
  type: "tool_approval_result";
  approval: StudioToolApproval;
};

export type StudioToolQuestionChoice = {
  label: string;
  value: string;
};

export type StudioToolQuestionPrompt = {
  id: string;
  question: string;
  choices: StudioToolQuestionChoice[];
};

export type StudioToolQuestionAnswer = {
  questionId: string;
  answer: string;
  choice?: string;
  custom?: boolean;
};

export type StudioToolQuestionStatus = "pending" | "answered";

export type StudioToolQuestion = {
  id: string;
  runId: string;
  agentId: string;
  sessionId?: string;
  toolName: string;
  callId?: string;
  internalCallId: string;
  args: string;
  questions: StudioToolQuestionPrompt[];
  status: StudioToolQuestionStatus;
  requestedAt: string;
  answeredAt?: string;
  answers?: StudioToolQuestionAnswer[];
};

export type StudioToolQuestionTranscript = {
  id: string;
  status: StudioToolQuestionStatus;
  requestedAt: string;
  answeredAt?: string;
  questions: StudioToolQuestionPrompt[];
  answers?: StudioToolQuestionAnswer[];
};

export type StudioToolQuestionRequestEvent = {
  type: "tool_question_request";
  question: StudioToolQuestion;
};

export type StudioToolQuestionResultEvent = {
  type: "tool_question_result";
  question: StudioToolQuestion;
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

export type AgentRunRequest = {
  message: string | Message;
  history?: Message[];
  sessionId?: string;
  stream?: boolean;
  maxTurns?: number;
  toolConcurrency?: number;
  model?: StudioModelRef;
  metadata?: JsonObject;
  trace?: AgentTraceOptions;
};

export type AgentRunUIRequest = {
  messages: Message[];
  sessionId?: string;
  stream?: boolean;
  maxTurns?: number;
  toolConcurrency?: number;
  model?: StudioModelRef;
  metadata?: JsonObject;
  trace?: AgentTraceOptions;
};

export type AgentRunResponse = PromptResponse;

export type AgentRunStreamEvent =
  | AgentStreamEvent
  | StudioToolApprovalRequestEvent
  | StudioToolApprovalResultEvent
  | StudioToolQuestionRequestEvent
  | StudioToolQuestionResultEvent
  | StudioSessionLogEvent
  | StudioPipelineLogEvent
  | StudioPipelineFinalEvent;

export type StudioErrorCode =
  | "bad_request"
  | "conflict"
  | "not_found"
  | "unsupported_capability"
  | "internal_error";

export type StudioErrorResponse = {
  error: {
    code: StudioErrorCode;
    message: string;
    details?: JsonValue;
  };
};

export function traceSummary(trace: StudioTrace): StudioTraceSummary {
  return compact({
    id: trace.id,
    sessionId: trace.sessionId,
    name: trace.name,
    status: trace.status,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    output: trace.output,
    error: trace.error,
    usage: trace.usage,
    metadata: trace.metadata,
    observationCount: trace.observations.length,
  }) as StudioTraceSummary;
}

export type AnviaStudio = {
  readonly app: Hono;
  fetch(request: Request): Response | Promise<Response>;
  config(): StudioConfig;
  close(): void;
};
