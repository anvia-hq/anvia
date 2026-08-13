import type {
  CompletionModel,
  Document,
  JsonValue,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import type { GuardrailPolicy, GuardrailPolicyInput } from "../guardrails";
import type { PromptHook } from "../hooks";
import type { McpServer } from "../mcp";
import type { MemoryOptions, MemoryRegistration, MemoryStore } from "../memory/types";
import type { AgentObserver, AgentObserverRegistration, ObserveOptions } from "../observability";
import type { ZodSchema } from "../schema";
import type { SkillSet } from "../skills";
import type { ToolSearchDocument } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import type { AnyTool, ToolApprovalsOptions } from "../tool/tool";
import type { ToolSet } from "../tool/tool-set";
import type { VectorFilter, VectorSearchIndex, VectorSearchResult } from "../vector-store";

export type AgentOptions<M extends CompletionModel = CompletionModel, ContextDocument = unknown> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  context?: Document[] | undefined;
  tools?: Array<AnyTool | ProviderTool> | undefined;
  mcpServers?: McpServer[] | undefined;
  skills?: SkillSet | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  toolChoice?: ToolChoice | undefined;
  maxTurns?: number | undefined;
  hook?: PromptHook | undefined;
  outputSchema?: ZodSchema | undefined;
  observers?: AgentObserverInput[] | undefined;
  approvals?: ToolApprovalsOptions | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  dynamicContexts?: AgentDynamicContext<ContextDocument>[] | undefined;
  dynamicTools?: AgentDynamicTool[] | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  memory?: AgentMemoryOptions | undefined;
};

export type AgentObserverInput = AgentObserver | (ObserveOptions & { observer: AgentObserver });

export type AgentMemoryOptions = MemoryOptions & {
  store: MemoryStore;
};

export type AgentDynamicContext<T = unknown> = DynamicContextOptions<T> & {
  index: VectorSearchIndex<T>;
};

export type AgentDynamicTool = DynamicToolOptions & {
  index: VectorSearchIndex<ToolSearchDocument>;
};

export type ResolvedAgentOptions<M extends CompletionModel = CompletionModel> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  staticContext?: Document[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  toolSet?: ToolSet | undefined;
  providerTools?: ProviderTool[] | undefined;
  toolChoice?: ToolChoice | undefined;
  defaultMaxTurns?: number | undefined;
  hook?: PromptHook | undefined;
  outputSchema?: import("../completion/index").JsonObject | undefined;
  observers?: AgentObserverRegistration[] | undefined;
  approvals?: ToolApprovalsOptions | undefined;
  guardrails?: GuardrailPolicy[] | undefined;
  dynamicContexts?: DynamicContextRegistration[] | undefined;
  dynamicTools?: DynamicToolRegistration[] | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  memory?: MemoryRegistration | undefined;
  /** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
  eventStore?: AgentEventStoreRegistration | undefined;
};

export type AgentToolOptions = {
  name: string;
  description?: string | undefined;
  maxTurns?: number | undefined;
  stream?: boolean | undefined;
};

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export type AgentEventStoreInclude = "all" | "agent_tool_events";

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export type AgentEventStoreOptions = {
  include?: AgentEventStoreInclude | undefined;
};

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export type AgentEventAppendInput = {
  runId: string;
  agentId: string;
  agentName?: string | undefined;
  turn?: number | undefined;
  toolName?: string | undefined;
  toolCallId?: string | undefined;
  internalCallId?: string | undefined;
  event: unknown;
};

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export type AgentEventRecord = AgentEventAppendInput & {
  createdAt?: Date | undefined;
};

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export interface AgentEventStore {
  append(input: AgentEventAppendInput): Promise<void>;
  load(runId: string): Promise<AgentEventRecord[]>;
  clear?(runId: string): Promise<void>;
}

/** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
export type AgentEventStoreRegistration = {
  store: AgentEventStore;
  options: Required<AgentEventStoreOptions>;
};

export type DynamicContextOptions<T = unknown> = {
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
  format?: ((result: VectorSearchResult<T>) => Document) | undefined;
};

export type DynamicContextRegistration<T = unknown> = {
  index: VectorSearchIndex<T>;
  options: DynamicContextOptions<T>;
};

export type DynamicToolOptions = {
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
};

export type DynamicToolRegistration = {
  index: VectorSearchIndex<ToolSearchDocument>;
  options: DynamicToolOptions;
};
