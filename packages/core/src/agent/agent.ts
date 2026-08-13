import { z } from "zod";
import { isStreamingCompletionModel } from "../completion/create-completion";
import type {
  CompletionModel,
  ContextUsage,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import { getAssistantGenerationMetadata, isProviderTool } from "../completion/types";
import { appendGuardrailPolicies, type GuardrailPolicy } from "../guardrails";
import type { AgentHook } from "../hooks";
import { AgentRun } from "../internal/agent-runtime/agent-run";
import { resolveMemoryOptions } from "../memory/options";
import type { MemoryContext, MemoryRegistration, SessionOptions } from "../memory/types";
import type { AgentObserverRegistration } from "../observability";
import { toProviderJsonSchema } from "../schema/zod-schema";
import { createTool } from "../tool/create-tool";
import { isToolIndex, type ToolIndex } from "../tool/dynamic-tools";
import { ToolCallError, ToolJsonError, ToolNotFoundError } from "../tool/errors";
import type { AgentMiddleware } from "../tool/middleware";
import { isSkillTool } from "../tool/skill-tool-marker";
import {
  type AnyTool,
  type NormalizedToolOutput,
  normalizeToolResultOutput,
  parseToolArgs,
  type Tool,
  type ToolApprovalsOptions,
  type ToolCallContext,
  type ToolCallStreamEvent,
} from "../tool/tool";
import { normalizeAgentId } from "./ids";
import type {
  AgentInput,
  AgentResponse,
  AgentRunOptions,
  AgentStream,
  AgentStreamEvent,
  AgentStreamEventWithoutToolCallDeltas,
  AgentStreamOptions,
} from "./run-types";
import type {
  AgentContextInput,
  AgentOptions,
  AgentToolOptions,
  ResolvedAgentOptions,
} from "./types";

export const DEFAULT_MAX_TURNS = 20;

export type AgentToolState = {
  staticTools: readonly AnyTool[];
  providerTools: readonly ProviderTool[];
  toolIndexes: readonly ToolIndex[];
  toolsByName: ReadonlyMap<string, AnyTool>;
};

const agentToolStates = new WeakMap<object, AgentToolState>();

export class Agent<M extends CompletionModel = CompletionModel, ContextDocument = unknown> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly model: M;
  readonly instructions: string | undefined;
  readonly context: readonly AgentContextInput<ContextDocument>[];
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly additionalParams: JsonValue | undefined;
  readonly tools: readonly AnyTool[];
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly hook: AgentHook | undefined;
  readonly outputSchema: JsonObject | undefined;
  readonly observers: AgentObserverRegistration[];
  readonly approvals: ToolApprovalsOptions | undefined;
  readonly guardrails: GuardrailPolicy[];
  readonly middlewares: AgentMiddleware[];
  readonly memory: MemoryRegistration | undefined;

  constructor(options: AgentOptions<M, ContextDocument>) {
    const resolved = resolveAgentOptions(options);
    this.id = normalizeAgentId(resolved.id);
    this.name = resolved.name;
    this.description = resolved.description;
    this.model = resolved.model;
    this.instructions = resolved.instructions;
    this.context = Object.freeze([...(resolved.context ?? [])]);
    this.temperature = resolved.temperature;
    this.maxTokens = resolved.maxTokens;
    this.additionalParams = resolved.additionalParams;
    const staticTools = dedupeTools(resolved.tools ?? []);
    const toolIndexes = [...(resolved.toolIndexes ?? [])];
    const toolsByName = new Map(staticTools.map((tool) => [tool.name, tool]));
    for (const index of toolIndexes) {
      for (const tool of index.tools) {
        if (!toolsByName.has(tool.name)) {
          toolsByName.set(tool.name, tool);
        }
      }
    }
    this.tools = Object.freeze([...toolsByName.values()]);
    agentToolStates.set(this, {
      staticTools: Object.freeze(staticTools),
      providerTools: Object.freeze([...(resolved.providerTools ?? [])]),
      toolIndexes: Object.freeze(toolIndexes),
      toolsByName,
    });
    this.toolChoice = resolved.toolChoice;
    this.defaultMaxTurns = resolved.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
    this.hook = resolved.hook;
    this.outputSchema = resolved.outputSchema;
    this.observers = [...(resolved.observers ?? [])];
    this.approvals = resolved.approvals;
    this.guardrails = [...(resolved.guardrails ?? [])];
    this.middlewares = [...(resolved.middlewares ?? [])];
    this.memory = resolved.memory;
  }

  generate(input: AgentInput, options: AgentRunOptions = {}): Promise<AgentResponse> {
    return AgentRun.fromAgent(this, input, options).generate();
  }

  stream(
    input: AgentInput,
    options: AgentStreamOptions & { includeToolCallDeltas: false },
  ): AgentStream<AgentStreamEventWithoutToolCallDeltas>;
  stream(
    input: AgentInput,
    options?: AgentStreamOptions & { includeToolCallDeltas?: true },
  ): AgentStream<AgentStreamEvent>;
  stream(input: AgentInput, options: AgentStreamOptions): AgentStream<AgentStreamEvent>;
  stream(input: AgentInput, options: AgentStreamOptions = {}): AgentStream<AgentStreamEvent> {
    return new DefaultAgentStream(
      AgentRun.fromAgent(this, input, options),
      options.includeToolCallDeltas !== false,
    );
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
      inputSchema: z.object({
        prompt: z.string().describe("The prompt to send to the agent."),
      }),
      outputSchema: z.string(),
      execute: async ({ prompt }, context: ToolCallContext) => {
        if (
          options.stream === true &&
          context.emitStreamEvent !== undefined &&
          this.model.capabilities.streaming &&
          isStreamingCompletionModel(this.model)
        ) {
          let output = "";
          const childStream = this.stream(prompt, {
            maxTurns: options.maxTurns,
            includeToolCallDeltas: context.includeToolCallDeltas !== false,
          });
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
        const response = await this.generate(prompt, { maxTurns: options.maxTurns });
        return response.output;
      },
    });
  }

  getTool(toolName: string): AnyTool | undefined {
    return getAgentToolState(this).toolsByName.get(toolName);
  }

  async callTool(
    toolName: string,
    args: string,
    context?: ToolCallContext,
  ): Promise<NormalizedToolOutput> {
    const tool = this.getTool(toolName);
    if (tool === undefined) {
      throw new ToolNotFoundError(toolName);
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = parseToolArgs(args);
    } catch (error) {
      throw new ToolJsonError(`Invalid JSON arguments for tool ${toolName}`, error);
    }

    try {
      return normalizeToolResultOutput(await tool.call(parsedArgs, context));
    } catch (error) {
      if (error instanceof Error) {
        throw new ToolCallError(error.message, error);
      }
      throw new ToolCallError(`Tool ${toolName} failed`, error);
    }
  }

  shouldApplyToolMiddleware(toolName: string): boolean {
    return !isSkillTool(this.getTool(toolName));
  }
}

const resolvedAgentOptions = Symbol("resolvedAgentOptions");

type InternalAgentOptions<M extends CompletionModel, ContextDocument> = ResolvedAgentOptions<
  M,
  ContextDocument
> & {
  [resolvedAgentOptions]: true;
};

export function createResolvedAgent<M extends CompletionModel, ContextDocument = unknown>(
  options: ResolvedAgentOptions<M, ContextDocument>,
): Agent<M, ContextDocument> {
  return new Agent({
    ...options,
    [resolvedAgentOptions]: true,
  } as unknown as AgentOptions<M, ContextDocument>);
}

export function getResolvedAgentOptions<M extends CompletionModel, ContextDocument>(
  agent: Agent<M, ContextDocument>,
): ResolvedAgentOptions<M, ContextDocument> {
  const toolState = getAgentToolState(agent);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    instructions: agent.instructions,
    context: [...agent.context],
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    additionalParams: agent.additionalParams,
    tools: [...toolState.staticTools],
    providerTools: [...toolState.providerTools],
    toolIndexes: [...toolState.toolIndexes],
    toolChoice: agent.toolChoice,
    defaultMaxTurns: agent.defaultMaxTurns,
    hook: agent.hook,
    outputSchema: agent.outputSchema,
    observers: [...agent.observers],
    approvals: agent.approvals,
    guardrails: [...agent.guardrails],
    middlewares: [...agent.middlewares],
    memory: agent.memory,
  };
}

export function getAgentToolState(agent: Agent): AgentToolState {
  const state = agentToolStates.get(agent);
  if (state === undefined) {
    throw new TypeError("Agent tool state is unavailable.");
  }
  return state;
}

function resolveAgentOptions<M extends CompletionModel, ContextDocument>(
  options: AgentOptions<M, ContextDocument>,
): ResolvedAgentOptions<M, ContextDocument> {
  if (isInternalAgentOptions(options)) {
    return options as unknown as ResolvedAgentOptions<M, ContextDocument>;
  }

  const toolsByName = new Map<string, AnyTool>();
  const providerTools: ProviderTool[] = [];
  const toolIndexes: ToolIndex[] = [];
  for (const tool of options.tools ?? []) {
    if (isProviderTool(tool)) {
      providerTools.push(tool);
    } else if (isToolIndex(tool)) {
      toolIndexes.push(tool);
    } else {
      toolsByName.set(tool.name, tool);
    }
  }
  for (const server of options.mcpServers ?? []) {
    for (const tool of server.tools) {
      toolsByName.set(tool.name, tool);
    }
  }
  if (options.skills !== undefined) {
    for (const tool of options.skills.tools) {
      toolsByName.set(tool.name, tool);
    }
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
    context: [...(options.context ?? [])],
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    additionalParams: options.additionalParams,
    tools: [...toolsByName.values()],
    providerTools,
    toolIndexes,
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
    middlewares: [...(options.middlewares ?? [])],
    memory,
  };
}

function isInternalAgentOptions<M extends CompletionModel, ContextDocument>(
  options: AgentOptions<M, ContextDocument>,
): boolean {
  return (
    (options as unknown as Partial<InternalAgentOptions<M, ContextDocument>>)[
      resolvedAgentOptions
    ] === true
  );
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

class DefaultAgentStream<Event extends AgentStreamEvent = AgentStreamEvent>
  implements AgentStream<Event>
{
  constructor(
    private readonly run: AgentRun,
    private readonly includeToolCallDeltas: boolean,
  ) {}

  steer(input: AgentInput): boolean {
    return this.run.steer(input);
  }

  [Symbol.asyncIterator](): AsyncIterator<Event> {
    return this.run
      .events(this.includeToolCallDeltas)
      [Symbol.asyncIterator]() as AsyncIterator<Event>;
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

  generate(input: string | MessageType, options: AgentRunOptions = {}): Promise<AgentResponse> {
    if (Array.isArray(input)) {
      throw new TypeError("AgentSession.generate does not accept Message[] transcripts.");
    }
    return AgentRun.fromAgent(this.agent, input, {
      ...options,
      memoryContext: this.context,
    }).generate();
  }

  stream(
    input: string | MessageType,
    options: AgentStreamOptions & { includeToolCallDeltas: false },
  ): AgentStream<AgentStreamEventWithoutToolCallDeltas>;
  stream(
    input: string | MessageType,
    options?: AgentStreamOptions & { includeToolCallDeltas?: true },
  ): AgentStream<AgentStreamEvent>;
  stream(input: string | MessageType, options: AgentStreamOptions): AgentStream<AgentStreamEvent>;
  stream(
    input: string | MessageType,
    options: AgentStreamOptions = {},
  ): AgentStream<AgentStreamEvent> {
    if (Array.isArray(input)) {
      throw new TypeError("AgentSession.stream does not accept Message[] transcripts.");
    }
    return new DefaultAgentStream(
      AgentRun.fromAgent(this.agent, input, {
        ...options,
        memoryContext: this.context,
      }),
      options.includeToolCallDeltas !== false,
    );
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

function dedupeTools(tools: readonly AnyTool[]): AnyTool[] {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
