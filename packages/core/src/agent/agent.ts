import { z } from "zod";
import { isStreamingCompletionModel } from "../completion/create-completion";
import type {
  CompletionModel,
  ContextUsage,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import { getAssistantGenerationMetadata, isProviderTool } from "../completion/types";
import { appendGuardrailPolicies, type GuardrailPolicy } from "../guardrails";
import type { PromptHook } from "../hooks";
import { resolveMemoryOptions } from "../memory/options";
import type { MemoryContext, MemoryRegistration, SessionOptions } from "../memory/types";
import type { AgentObserverRegistration } from "../observability";
import { PromptRequest } from "../request";
import { toProviderJsonSchema } from "../schema/zod-schema";
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
  ToolCallStreamEvent,
} from "../tool/tool";
import { ToolSet } from "../tool/tool-set";
import type { VectorSearchIndex } from "../vector-store";
import { normalizeAgentId } from "./ids";
import type {
  AgentDynamicContext,
  AgentEventStoreRegistration,
  AgentOptions,
  AgentToolOptions,
  DynamicContextRegistration,
  DynamicToolRegistration,
  ResolvedAgentOptions,
} from "./types";

export const DEFAULT_MAX_TURNS = 20;

export class Agent<M extends CompletionModel = CompletionModel, ContextDocument = unknown> {
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
  readonly providerTools: ProviderTool[];
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly hook: PromptHook | undefined;
  readonly outputSchema: JsonObject | undefined;
  readonly observers: AgentObserverRegistration[];
  readonly approvals: ToolApprovalsOptions | undefined;
  readonly guardrails: GuardrailPolicy[];
  readonly dynamicContexts: DynamicContextRegistration[];
  readonly dynamicTools: DynamicToolRegistration[];
  readonly middlewares: AgentMiddleware[];
  readonly memory: MemoryRegistration | undefined;
  /** @deprecated Event stores will be removed in 1.0. Use observers for run inspection. */
  readonly eventStore: AgentEventStoreRegistration | undefined;

  constructor(options: AgentOptions<M, ContextDocument>) {
    const resolved = resolveAgentOptions(options);
    this.id = normalizeAgentId(resolved.id);
    this.name = resolved.name;
    this.description = resolved.description;
    this.model = resolved.model;
    this.instructions = resolved.instructions;
    this.staticContext = [...(resolved.staticContext ?? [])];
    this.temperature = resolved.temperature;
    this.maxTokens = resolved.maxTokens;
    this.additionalParams = resolved.additionalParams;
    this.toolSet = resolved.toolSet ?? new ToolSet();
    this.providerTools = [...(resolved.providerTools ?? [])];
    this.toolChoice = resolved.toolChoice;
    this.defaultMaxTurns = resolved.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
    this.hook = resolved.hook;
    this.outputSchema = resolved.outputSchema;
    this.observers = [...(resolved.observers ?? [])];
    this.approvals = resolved.approvals;
    this.guardrails = [...(resolved.guardrails ?? [])];
    this.dynamicContexts = [...(resolved.dynamicContexts ?? [])];
    this.dynamicTools = [...(resolved.dynamicTools ?? [])];
    this.middlewares = [...(resolved.middlewares ?? [])];
    this.memory = resolved.memory;
    this.eventStore = resolved.eventStore;
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
    const context: MemoryContext = {
      sessionId: normalized,
    };
    if (options.userId !== undefined) {
      context.userId = options.userId;
    }
    if (options.metadata !== undefined) {
      context.metadata = options.metadata;
    }
    return new AgentSession(this, context);
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
          const childStream =
            context.includeToolCallDeltas === false
              ? childRequest.stream({ includeToolCallDeltas: false })
              : childRequest.stream();
          for await (const event of childStream) {
            const streamEvent: ToolCallStreamEvent = {
              agentId: this.id,
              event,
            };
            if (this.name !== undefined) {
              streamEvent.agentName = this.name;
            }
            await context.emitStreamEvent(streamEvent);
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

const resolvedAgentOptions = Symbol("resolvedAgentOptions");

type InternalAgentOptions<M extends CompletionModel> = ResolvedAgentOptions<M> & {
  [resolvedAgentOptions]: true;
};

export function createResolvedAgent<M extends CompletionModel>(
  options: ResolvedAgentOptions<M>,
): Agent<M> {
  return new Agent({
    ...options,
    [resolvedAgentOptions]: true,
  } as unknown as AgentOptions<M>);
}

function resolveAgentOptions<M extends CompletionModel, ContextDocument>(
  options: AgentOptions<M, ContextDocument>,
): ResolvedAgentOptions<M> {
  if (isInternalAgentOptions(options)) {
    return options as unknown as ResolvedAgentOptions<M>;
  }

  const toolSet = new ToolSet();
  const providerTools: ProviderTool[] = [];
  for (const tool of options.tools ?? []) {
    if (isProviderTool(tool)) {
      providerTools.push(tool);
    } else {
      toolSet.addTool(tool);
    }
  }
  for (const server of options.mcpServers ?? []) {
    toolSet.addTools(server.tools);
  }
  if (options.skills !== undefined) {
    toolSet.addTools(options.skills.tools);
  }

  const memory = resolveAgentMemory(options);
  const instructions = [options.instructions, options.skills?.instructions]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    model: options.model,
    instructions: instructions.length === 0 ? undefined : instructions,
    staticContext: [...(options.context ?? [])],
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    additionalParams: options.additionalParams,
    toolSet,
    providerTools,
    toolChoice: options.toolChoice,
    defaultMaxTurns: options.maxTurns,
    hook: options.hook,
    outputSchema:
      options.outputSchema === undefined ? undefined : toProviderJsonSchema(options.outputSchema),
    observers: (options.observers ?? []).map((input) =>
      "observer" in input
        ? { observer: input.observer, failOnObserverError: input.failOnObserverError }
        : { observer: input },
    ),
    approvals: options.approvals,
    guardrails:
      options.guardrails === undefined ? [] : appendGuardrailPolicies([], options.guardrails),
    dynamicContexts: (options.dynamicContexts ?? []).map(
      resolveDynamicContext,
    ) as unknown as DynamicContextRegistration[],
    dynamicTools: (options.dynamicTools ?? []).map(({ index, ...dynamicOptions }) => ({
      index,
      options: dynamicOptions,
    })),
    middlewares: [...(options.middlewares ?? [])],
    memory,
  };
}

function isInternalAgentOptions<M extends CompletionModel, ContextDocument>(
  options: AgentOptions<M, ContextDocument>,
): boolean {
  return (options as unknown as Partial<InternalAgentOptions<M>>)[resolvedAgentOptions] === true;
}

function resolveDynamicContext<T>({
  index,
  ...options
}: AgentDynamicContext<T>): DynamicContextRegistration<T> {
  return { index, options };
}

function resolveAgentMemory<M extends CompletionModel, ContextDocument>(
  options: AgentOptions<M, ContextDocument>,
): MemoryRegistration | undefined {
  if (options.memory === undefined) {
    return undefined;
  }
  const { store, ...memoryOptions } = options.memory;
  const resolvedOptions = resolveMemoryOptions(memoryOptions);
  if (resolvedOptions.compaction !== undefined && store.compaction === undefined) {
    throw new TypeError(
      "Memory compaction requires a store with the optional compaction capability.",
    );
  }
  return { store, options: resolvedOptions };
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

  async contextUsage(): Promise<ContextUsage | undefined> {
    const messages = await this.messages();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message === undefined) {
        continue;
      }
      const generation = getAssistantGenerationMetadata(message);
      if (generation !== undefined) {
        return generation.contextUsage;
      }
    }
    return undefined;
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
