import type {
  CompletionModel,
  Document,
  JsonObject,
  JsonValue,
  ToolChoice,
} from "../completion/index";
import type { PromptHook } from "../hooks";
import type { MemoryRegistration } from "../memory/types";
import type { AgentObserverRegistration } from "../observability";
import type { ToolSearchDocument } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import type { ToolApprovalsOptions } from "../tool/tool";
import type { ToolSet } from "../tool/tool-set";
import type { VectorFilter, VectorSearchIndex, VectorSearchResult } from "../vector-store";

export type AgentOptions<M extends CompletionModel = CompletionModel> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  staticContext?: Document[];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  toolSet?: ToolSet | undefined;
  toolChoice?: ToolChoice | undefined;
  defaultMaxTurns?: number | undefined;
  hook?: PromptHook | undefined;
  outputSchema?: JsonObject | undefined;
  observers?: AgentObserverRegistration[] | undefined;
  approvals?: ToolApprovalsOptions | undefined;
  dynamicContexts?: DynamicContextRegistration[] | undefined;
  dynamicTools?: DynamicToolRegistration[] | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  /**
   * @deprecated Use `middlewares` instead.
   */
  toolMiddlewares?: AgentMiddleware[] | undefined;
  memory?: MemoryRegistration | undefined;
  eventStore?: AgentEventStoreRegistration | undefined;
};

export type AgentToolOptions = {
  name: string;
  description?: string | undefined;
  maxTurns?: number | undefined;
  stream?: boolean | undefined;
};

export type AgentEventStoreInclude = "all" | "agent_tool_events";

export type AgentEventStoreOptions = {
  include?: AgentEventStoreInclude | undefined;
};

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

export type AgentEventRecord = AgentEventAppendInput & {
  createdAt?: Date | undefined;
};

export interface AgentEventStore {
  append(input: AgentEventAppendInput): Promise<void>;
  load(runId: string): Promise<AgentEventRecord[]>;
  clear?(runId: string): Promise<void>;
}

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
