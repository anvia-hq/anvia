import type {
  CompletionModel,
  Document,
  JsonValue,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import type { GuardrailPolicy, GuardrailPolicyInput } from "../guardrails";
import type { AgentHook } from "../hooks";
import type { McpServer } from "../mcp";
import type { MemoryOptions, MemoryRegistration, MemoryStore } from "../memory/types";
import type { AgentObserver, AgentObserverRegistration, ObserveOptions } from "../observability";
import type { ZodSchema } from "../schema";
import type { SkillSet } from "../skills";
import type { ToolIndex } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import type { AnyTool, ToolApprovalsOptions } from "../tool/tool";
import type { ContextIndex } from "./context-index";

export type AgentToolInput = AnyTool | ProviderTool | ToolIndex;
export type AgentContextInput<T = unknown> = Document | ContextIndex<T>;

export type AgentOptions<M extends CompletionModel = CompletionModel, ContextDocument = unknown> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  context?: readonly AgentContextInput<ContextDocument>[] | undefined;
  tools?: readonly AgentToolInput[] | undefined;
  mcpServers?: McpServer[] | undefined;
  skills?: SkillSet | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  toolChoice?: ToolChoice | undefined;
  maxTurns?: number | undefined;
  hook?: AgentHook | undefined;
  outputSchema?: ZodSchema | undefined;
  observers?: AgentObserverInput[] | undefined;
  approvals?: ToolApprovalsOptions | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  memory?: AgentMemoryOptions | undefined;
};

export type AgentObserverInput = AgentObserver | (ObserveOptions & { observer: AgentObserver });

export type AgentMemoryOptions = MemoryOptions & {
  store: MemoryStore;
};

export type ResolvedAgentOptions<
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  context?: AgentContextInput<ContextDocument>[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  tools?: AnyTool[] | undefined;
  providerTools?: ProviderTool[] | undefined;
  toolIndexes?: ToolIndex[] | undefined;
  toolChoice?: ToolChoice | undefined;
  defaultMaxTurns?: number | undefined;
  hook?: AgentHook | undefined;
  outputSchema?: import("../completion/index").JsonObject | undefined;
  observers?: AgentObserverRegistration[] | undefined;
  approvals?: ToolApprovalsOptions | undefined;
  guardrails?: GuardrailPolicy[] | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  memory?: MemoryRegistration | undefined;
};

export type AgentToolOptions = {
  name: string;
  description?: string | undefined;
  maxTurns?: number | undefined;
  stream?: boolean | undefined;
};
