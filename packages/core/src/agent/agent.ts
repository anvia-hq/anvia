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
import type { AgentLifecycle } from "./lifecycle";
import type {
  AgentApprovalDecision,
  AgentApprovalRequiredEvent,
  AgentApprovalRequiredResult,
  AgentInput,
  AgentResult,
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

type AgentLegacyRuntime = {
  legacy: boolean;
  hook?: AgentHook | undefined;
  approvals?: ToolApprovalsOptions | undefined;
};

const agentToolStates = new WeakMap<object, AgentToolState>();
const agentLegacyRuntimes = new WeakMap<object, AgentLegacyRuntime>();

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
  readonly lifecycle: AgentLifecycle | undefined;
  readonly outputSchema: JsonObject | undefined;
  readonly observers: AgentObserverRegistration[];
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
    this.lifecycle = resolved.lifecycle;
    this.outputSchema = resolved.outputSchema;
    this.observers = [...(resolved.observers ?? [])];
    agentLegacyRuntimes.set(this, {
      legacy: resolved.legacy === true,
      hook: resolved.hook,
      approvals: resolved.approvals,
    });
    this.guardrails = [...(resolved.guardrails ?? [])];
    this.middlewares = [...(resolved.middlewares ?? [])];
    this.memory = resolved.memory;
  }

  generate(input: AgentInput, options: AgentRunOptions = {}): Promise<AgentResult> {
    return createGenerateExecution(this, AgentRun.fromAgent(this, input, options)).next();
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
    return createStreamExecution(
      this,
      AgentRun.fromAgent(this, input, options),
      options.includeToolCallDeltas !== false,
    );
  }

  resume(
    pending: AgentApprovalRequiredResult,
    decision: AgentApprovalDecision,
  ): Promise<AgentResult>;
  resume(
    pending: AgentApprovalRequiredEvent,
    decision: AgentApprovalDecision,
  ): AgentStream<AgentStreamEvent>;
  resume(
    pending: AgentApprovalRequiredResult | AgentApprovalRequiredEvent,
    decision: AgentApprovalDecision,
  ): Promise<AgentResult> | AgentStream<AgentStreamEvent> {
    assertAgentApprovalDecision(decision);
    const continuation = approvalContinuations.get(pending);
    if (continuation === undefined || continuation.agent !== this) {
      throw new TypeError("Approval continuation does not belong to this agent.");
    }
    approvalContinuations.delete(pending);
    continuation.run.resolveApproval(decision);
    return continuation.mode === "generate"
      ? continuation.execution.next()
      : continuation.execution.segment();
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
            } else if (event.type === "approval_required") {
              throw new Error(
                `Agent tool "${options.name}" cannot suspend for tool approval. Run the agent directly to handle approvals.`,
              );
            }
          }
          return output;
        }
        const response = await this.generate(prompt, { maxTurns: options.maxTurns });
        if (response.status === "approval_required") {
          throw new Error(
            `Agent tool "${options.name}" cannot suspend for tool approval. Run the agent directly to handle approvals.`,
          );
        }
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
    legacy: getAgentLegacyRuntime(agent).legacy,
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
    lifecycle: agent.lifecycle,
    hook: getAgentLegacyRuntime(agent).hook,
    outputSchema: agent.outputSchema,
    observers: [...agent.observers],
    approvals: getAgentLegacyRuntime(agent).approvals,
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

export function getAgentLegacyRuntime(agent: Agent): AgentLegacyRuntime {
  return agentLegacyRuntimes.get(agent) ?? { legacy: false };
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
    legacy: false,
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
    lifecycle: options.lifecycle,
    outputSchema:
      options.outputSchema === undefined ? undefined : toProviderJsonSchema(options.outputSchema),
    observers: (options.observers ?? []).map((input) =>
      "observer" in input
        ? { observer: input.observer, failOnObserverError: input.failOnObserverError }
        : { observer: input },
    ),
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

type GenerateExecution = {
  next(): Promise<AgentResult>;
};

type ApprovalContinuation =
  | {
      agent: Agent;
      run: AgentRun;
      mode: "generate";
      execution: GenerateExecution;
    }
  | {
      agent: Agent;
      run: AgentRun;
      mode: "stream";
      execution: StreamExecution;
    };

const approvalContinuations = new WeakMap<object, ApprovalContinuation>();

function assertAgentApprovalDecision(decision: AgentApprovalDecision): void {
  if (typeof decision !== "object" || decision === null || typeof decision.approved !== "boolean") {
    throw new TypeError("Approval decision must include an approved boolean.");
  }
  if (decision.reason !== undefined && typeof decision.reason !== "string") {
    throw new TypeError("Approval decision reason must be a string.");
  }
}

function createGenerateExecution(agent: Agent, run: AgentRun): GenerateExecution {
  const completion = run.generate();
  const execution: GenerateExecution = {
    async next() {
      const outcome = await Promise.race([
        completion.then((result) => ({ type: "completed" as const, result })),
        run.waitForApproval().then(() => ({ type: "approval" as const })),
      ]);
      if (outcome.type === "completed") {
        return outcome.result;
      }
      const pending = run.approvalResult();
      approvalContinuations.set(pending, { agent, run, mode: "generate", execution });
      return pending;
    },
  };
  return execution;
}

class StreamExecution {
  private readonly iterator: AsyncIterator<AgentStreamEvent>;
  private nextEvent: Promise<IteratorResult<AgentStreamEvent>> | undefined;

  constructor(
    private readonly agent: Agent,
    private readonly run: AgentRun,
    includeToolCallDeltas: boolean,
  ) {
    this.iterator = run.events(includeToolCallDeltas)[Symbol.asyncIterator]();
  }

  segment(): AgentStream<AgentStreamEvent> {
    return new DefaultAgentStream(this);
  }

  steer(input: AgentInput): boolean {
    return this.run.steer(input);
  }

  async *events(): AsyncIterable<AgentStreamEvent> {
    while (true) {
      this.nextEvent ??= this.iterator.next();
      const outcome = await Promise.race([
        this.nextEvent.then((event) => ({ type: "event" as const, event })),
        this.run.waitForApproval().then(() => ({ type: "approval" as const })),
      ]);
      if (outcome.type === "approval") {
        const pending = this.run.approvalEvent();
        approvalContinuations.set(pending, {
          agent: this.agent,
          run: this.run,
          mode: "stream",
          execution: this,
        });
        yield pending;
        return;
      }
      this.nextEvent = undefined;
      if (outcome.event.done) return;
      yield outcome.event.value;
    }
  }
}

function createStreamExecution(
  agent: Agent,
  run: AgentRun,
  includeToolCallDeltas: boolean,
): AgentStream<AgentStreamEvent> {
  return new StreamExecution(agent, run, includeToolCallDeltas).segment();
}

class DefaultAgentStream<Event extends AgentStreamEvent = AgentStreamEvent>
  implements AgentStream<Event>
{
  private consuming = false;
  private completed = false;

  constructor(private readonly execution: StreamExecution) {}

  steer(input: AgentInput): boolean {
    return this.execution.steer(input);
  }

  [Symbol.asyncIterator](): AsyncIterator<Event> {
    return this.consume()[Symbol.asyncIterator]();
  }

  private async *consume(): AsyncIterableIterator<Event> {
    if (this.completed) {
      throw new Error("Agent stream has already been consumed.");
    }
    if (this.consuming) {
      throw new Error("Agent stream is already running.");
    }
    this.consuming = true;
    try {
      for await (const event of this.execution.events()) {
        yield event as Event;
      }
    } finally {
      this.consuming = false;
      this.completed = true;
    }
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

  generate(input: string | MessageType, options: AgentRunOptions = {}): Promise<AgentResult> {
    if (Array.isArray(input)) {
      throw new TypeError("AgentSession.generate does not accept Message[] transcripts.");
    }
    const run = AgentRun.fromAgent(this.agent, input, {
      ...options,
      memoryContext: this.context,
    });
    return createGenerateExecution(this.agent, run).next();
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
    return createStreamExecution(
      this.agent,
      AgentRun.fromAgent(this.agent, input, { ...options, memoryContext: this.context }),
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
