import { z } from "zod";
import type {
  CompletionModel,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ToolChoice,
} from "../completion/index";
import { compact } from "../internal/compact";
import type { MemoryRegistration, SessionOptions } from "../memory";
import type { AgentObserverRegistration } from "../observability";
import { createTool } from "../tool/create-tool";
import type { ToolSearchDocument } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import { isSkillTool } from "../tool/skill-tool-marker";
import type {
  AnyTool,
  NormalizedToolOutput,
  Tool,
  ToolApprovalsOptions,
  ToolCallContext,
} from "../tool/tool";
import { ToolSet } from "../tool/tool-set";
import type { VectorFilter, VectorSearchIndex, VectorSearchResult } from "../vector-store";
import type { PromptHook } from "./hooks";
import { normalizeAgentId } from "./ids";
import { PromptRequest } from "./request";
import { isStreamingCompletionModel } from "./utils";

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

export const DEFAULT_MAX_TURNS = 20;

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

export class Agent<M extends CompletionModel = CompletionModel> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly model: M;
  readonly instructions: string | undefined;
  readonly staticContext: Document[];
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly additionalParams: JsonValue | undefined;
  readonly toolSet: ToolSet;
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly hook: PromptHook | undefined;
  readonly outputSchema: JsonObject | undefined;
  readonly observers: AgentObserverRegistration[];
  readonly approvals: ToolApprovalsOptions | undefined;
  readonly dynamicContexts: DynamicContextRegistration[];
  readonly dynamicTools: DynamicToolRegistration[];
  readonly middlewares: AgentMiddleware[];
  /**
   * @deprecated Use `middlewares` instead.
   */
  readonly toolMiddlewares: AgentMiddleware[];
  readonly memory: MemoryRegistration | undefined;
  readonly eventStore: AgentEventStoreRegistration | undefined;

  constructor(options: AgentOptions<M>) {
    this.id = normalizeAgentId(options.id);
    this.name = options.name;
    this.description = options.description;
    this.model = options.model;
    this.instructions = options.instructions;
    this.staticContext = options.staticContext ?? [];
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.additionalParams = options.additionalParams;
    this.toolSet = options.toolSet ?? new ToolSet();
    this.toolChoice = options.toolChoice;
    this.defaultMaxTurns = options.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
    this.hook = options.hook;
    this.outputSchema = options.outputSchema;
    this.observers = options.observers ?? [];
    this.approvals = options.approvals;
    this.dynamicContexts = options.dynamicContexts ?? [];
    this.dynamicTools = options.dynamicTools ?? [];
    this.middlewares = options.middlewares ?? options.toolMiddlewares ?? [];
    this.toolMiddlewares = this.middlewares;
    this.memory = options.memory;
    this.eventStore = options.eventStore;
  }

  prompt(prompt: string | MessageType | MessageType[]): PromptRequest<M> {
    return PromptRequest.fromAgent(this, prompt);
  }

  session(sessionId: string, options: SessionOptions = {}): AgentSession<M> {
    if (this.memory === undefined) {
      throw new Error(`Agent "${this.id}" has no memory store configured.`);
    }
    const normalized = sessionId.trim();
    if (normalized.length === 0) {
      throw new TypeError("Session id must be a non-empty string.");
    }
    return new AgentSession(this, {
      sessionId: normalized,
      ...(options.userId !== undefined && { userId: options.userId }),
      ...(options.metadata !== undefined && { metadata: options.metadata }),
    });
  }

  asTool(options: AgentToolOptions): Tool<{ prompt: string }, string> {
    const description =
      options.description ?? this.description ?? `Prompt the ${options.name} agent.`;

    return createTool({
      name: options.name,
      description,
      input: z.object({
        prompt: z.string().describe("The prompt to send to the agent."),
      }),
      output: z.string(),
      execute: async ({ prompt }, context: ToolCallContext) => {
        const request = this.prompt(prompt);
        const childRequest =
          options.maxTurns === undefined ? request : request.maxTurns(options.maxTurns);
        if (
          options.stream === true &&
          context.emitStreamEvent !== undefined &&
          this.model.capabilities.streaming &&
          isStreamingCompletionModel(this.model)
        ) {
          let output = "";
          for await (const event of childRequest.stream()) {
            await context.emitStreamEvent(
              compact({
                agentId: this.id,
                agentName: this.name,
                event,
              }),
            );
            if (event.type === "final") {
              output = event.output;
            }
          }
          return output;
        }
        const response = await childRequest.send();
        return response.output;
      },
    });
  }

  getTool(toolName: string): AnyTool | undefined {
    const staticTool = this.toolSet.get(toolName);
    if (staticTool !== undefined) {
      return staticTool;
    }

    for (const registration of this.dynamicTools) {
      const dynamicTool = dynamicToolSetFromIndex(registration.index)?.get(toolName);
      if (dynamicTool !== undefined) {
        return dynamicTool;
      }
    }

    return undefined;
  }

  async callTool(
    toolName: string,
    args: string,
    context?: ToolCallContext,
  ): Promise<NormalizedToolOutput> {
    if (this.toolSet.contains(toolName)) {
      return this.toolSet.call(toolName, args, context);
    }

    for (const registration of this.dynamicTools) {
      const toolSet = dynamicToolSetFromIndex(registration.index);
      if (toolSet?.contains(toolName)) {
        return toolSet.call(toolName, args, context);
      }
    }

    return this.toolSet.call(toolName, args, context);
  }

  shouldApplyToolMiddleware(toolName: string): boolean {
    return !isSkillTool(this.getTool(toolName));
  }
}

export class AgentSession<M extends CompletionModel = CompletionModel> {
  constructor(
    private readonly agent: Agent<M>,
    private readonly context: {
      sessionId: string;
      userId?: string | undefined;
      metadata?: JsonObject | undefined;
    },
  ) {}

  prompt(prompt: string | MessageType): PromptRequest<M> {
    if (Array.isArray(prompt)) {
      throw new TypeError("AgentSession.prompt does not accept Message[] transcripts.");
    }
    return PromptRequest.fromAgent(this.agent, prompt, { memoryContext: this.context });
  }

  async messages(): Promise<MessageType[]> {
    const memory = this.agent.memory;
    if (memory === undefined) {
      throw new Error(`Agent "${this.agent.id}" has no memory store configured.`);
    }
    return memory.store.load(this.context);
  }

  async clear(): Promise<void> {
    const memory = this.agent.memory;
    if (memory === undefined) {
      throw new Error(`Agent "${this.agent.id}" has no memory store configured.`);
    }
    await memory.store.clear(this.context);
  }
}

function dynamicToolSetFromIndex(
  index: VectorSearchIndex<ToolSearchDocument>,
): ToolSet | undefined {
  const maybeIndex = index as { toolSet?: unknown };
  return maybeIndex.toolSet instanceof ToolSet ? maybeIndex.toolSet : undefined;
}
