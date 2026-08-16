import type {
  CompletionModel,
  Document,
  JsonObject,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import type { GuardrailPolicy, GuardrailPolicyInput } from "../guardrails";
import type { McpServer } from "../mcp";
import type {
  MemoryCompactionConflictRetryOptions,
  MemoryCompactor,
  MemoryOptions,
  MemorySavePolicy,
  MemoryStore,
} from "../memory/types";
import type { AgentObservabilityOptions } from "../observability";
import type { RetrySetting } from "../retry";
import type { ZodSchema } from "../schema";
import type { SkillSet } from "../skills";
import type { ToolIndex } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import type { AnyTool } from "../tool/tool";
import type { AgentLifecycle } from "./lifecycle";
import type { VectorContext } from "./vector-context";

export type AgentToolInput = AnyTool | ProviderTool | ToolIndex;
export type AgentContextInput<T = unknown> = Document | VectorContext<T>;

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export type AgentOptions<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  context?: readonly AgentContextInput<ContextDocument>[] | undefined;
  tools?: readonly AgentToolInput[] | undefined;
  mcpServers?: readonly McpServer[] | undefined;
  skills?: SkillSet | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  toolChoice?: ToolChoice | undefined;
  maxTurns?: number | undefined;
  lifecycle?: AgentLifecycle<Output, RawResponseOf<M>> | undefined;
  outputSchema?: ZodSchema<Output> | undefined;
  observability?: AgentObservabilityOptions | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  middlewares?: readonly AgentMiddleware[] | undefined;
  memory?: AgentMemoryOptions | undefined;
};

export type AgentMemoryOptions = MemoryOptions & {
  store: MemoryStore;
};

export type AgentMemory = {
  store: MemoryStore;
  savePolicy: MemorySavePolicy;
  compaction?:
    | {
        trigger: { afterMessages: number };
        retention: { recentUserTurns: number };
        compactor: MemoryCompactor;
        conflictRetries: false | MemoryCompactionConflictRetryOptions;
      }
    | undefined;
};

export type ResolvedAgentOptions<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  context?: readonly AgentContextInput<ContextDocument>[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  tools?: readonly AnyTool[] | undefined;
  mcpServers?: readonly McpServer[] | undefined;
  providerTools?: readonly ProviderTool[] | undefined;
  toolIndexes?: readonly ToolIndex[] | undefined;
  toolChoice?: ToolChoice | undefined;
  defaultMaxTurns?: number | undefined;
  lifecycle?: AgentLifecycle<Output, RawResponseOf<M>> | undefined;
  outputSchema?: ZodSchema<Output> | undefined;
  observability?: AgentObservabilityOptions | undefined;
  guardrails?: readonly GuardrailPolicy[] | undefined;
  middlewares?: readonly AgentMiddleware[] | undefined;
  memory?: AgentMemory | undefined;
};

export type AgentToolOptions = {
  name: string;
  description?: string | undefined;
  maxTurns?: number | undefined;
  stream?: boolean | undefined;
};
