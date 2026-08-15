import { z } from "zod";
import { isStreamingCompletionModel } from "../completion/generate-completion";
import type {
  CompletionModel,
  ContextUsage,
  JsonObject,
  Message as MessageType,
  ProviderTool,
  ToolChoice,
} from "../completion/index";
import { getAssistantGenerationMetadata, isProviderTool } from "../completion/types";
import { appendGuardrailPolicies, type GuardrailPolicy } from "../guardrails";
import { AgentRun } from "../internal/agent-runtime/agent-run";
import { prepareToolCall } from "../internal/agent-runtime/prepared-tool-call";
import { assertNonnegativeSafeInteger } from "../internal/agent-runtime/run-validation";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import { resolveMemoryOptions } from "../memory/options";
import type { MemoryContext, MemoryRegistration, SessionOptions } from "../memory/types";
import type { AgentObserverRegistration } from "../observability";
import type { RetrySetting } from "../retry";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import { createTool } from "../tool/create-tool";
import { isToolIndex, type ToolIndex } from "../tool/dynamic-tools";
import { ToolNotFoundError } from "../tool/errors";
import type { AgentMiddleware } from "../tool/middleware";
import type {
  AnyTool,
  NormalizedToolOutput,
  Tool,
  ToolCallContext,
  ToolCallStreamEvent,
} from "../tool/tool";
import type { VectorInspectRequest, VectorSearchResult } from "../vector-store";
import { AgentRunBlockedError } from "./errors";
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
} from "./run-types";
import { getAgentToolState, getRegisteredAgentTool, registerAgentToolState } from "./tool-state";
import type {
  AgentContextInput,
  AgentOptions,
  AgentToolOptions,
  ResolvedAgentOptions,
} from "./types";
import { isVectorContext, type VectorContext } from "./vector-context";

const DEFAULT_MAX_TURNS = 20;

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse, infer _ModelName> ? RawResponse : unknown;

const providerOutputSchemas = new WeakMap<object, JsonObject>();

export class Agent<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly model: M;
  readonly instructions: string | undefined;
  readonly context: readonly AgentContextInput<ContextDocument>[];
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly providerOptions: JsonObject | undefined;
  readonly retries: RetrySetting | undefined;
  readonly tools: readonly AnyTool[];
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly lifecycle: AgentLifecycle<Output, RawResponseOf<M>> | undefined;
  readonly outputSchema: ZodSchema<Output> | undefined;
  readonly observers: readonly AgentObserverRegistration[];
  readonly guardrails: readonly GuardrailPolicy[];
  readonly middlewares: readonly AgentMiddleware[];
  readonly memory: MemoryRegistration | undefined;

  constructor(options: AgentOptions<Output, M, ContextDocument>) {
    const resolved = resolveAgentOptions(options);
    this.id = normalizeAgentId(resolved.id);
    this.name = resolved.name;
    this.description = resolved.description;
    this.model = resolved.model;
    this.instructions = resolved.instructions;
    const context = (resolved.context ?? []).map(snapshotContextInput);
    assertValidVectorContexts(context);
    this.context = Object.freeze(context);
    this.temperature = resolved.temperature;
    this.maxTokens = resolved.maxTokens;
    this.providerOptions = cloneFrozenPlainData(resolved.providerOptions);
    this.retries = cloneFrozenPlainData(resolved.retries);
    const staticTools = dedupeTools(resolved.tools ?? []);
    const toolIndexes = (resolved.toolIndexes ?? []).map(snapshotToolIndex);
    assertUniqueIndexedToolNames(toolIndexes);
    const toolsByName = new Map(staticTools.map((tool) => [tool.name, tool]));
    for (const index of toolIndexes) {
      for (const tool of index.tools) {
        if (!toolsByName.has(tool.name)) {
          toolsByName.set(tool.name, tool);
        }
      }
    }
    this.tools = Object.freeze([...toolsByName.values()]);
    const publicToolState = Object.freeze({
      staticTools: Object.freeze(staticTools),
      providerTools: Object.freeze((resolved.providerTools ?? []).map(snapshotProviderTool)),
      toolIndexes: Object.freeze(toolIndexes),
    });
    registerAgentToolState(this, publicToolState, toolsByName);
    this.toolChoice = cloneFrozenPlainData(resolved.toolChoice);
    this.defaultMaxTurns = assertNonnegativeSafeInteger(
      resolved.defaultMaxTurns ?? DEFAULT_MAX_TURNS,
      "maxTurns",
    );
    this.lifecycle = resolved.lifecycle;
    this.outputSchema = resolved.outputSchema;
    if (resolved.outputSchema !== undefined) {
      providerOutputSchemas.set(this, toProviderJsonSchema(resolved.outputSchema));
    }
    this.observers = Object.freeze(
      (resolved.observers ?? []).map((registration) => Object.freeze({ ...registration })),
    );
    this.guardrails = Object.freeze((resolved.guardrails ?? []).map(snapshotGuardrailPolicy));
    this.middlewares = Object.freeze([...(resolved.middlewares ?? [])]);
    this.memory = snapshotMemoryRegistration(resolved.memory);
  }

  generate(
    input: AgentInput,
    options: AgentRunOptions<Output, RawResponseOf<M>> = {},
  ): Promise<AgentResult<Output>> {
    return createGenerateExecution(this, AgentRun.fromAgent(this, input, options)).next();
  }

  stream(
    input: AgentInput,
    options: AgentRunOptions<Output, RawResponseOf<M>> = {},
  ): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
    const run = AgentRun.fromAgent(this, input, options);
    if (!this.model.capabilities.streaming || !isStreamingCompletionModel(this.model)) {
      throw new Error("This completion model does not support streaming");
    }
    return createStreamExecution(this, run);
  }

  resume(
    pending: AgentApprovalRequiredResult,
    decision: AgentApprovalDecision,
  ): Promise<AgentResult<Output>>;
  resume(
    pending: AgentApprovalRequiredEvent,
    decision: AgentApprovalDecision,
  ): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>>;
  resume(
    pending: AgentApprovalRequiredResult | AgentApprovalRequiredEvent,
    decision: AgentApprovalDecision,
  ): Promise<AgentResult<Output>> | AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
    assertAgentApprovalDecision(decision);
    const continuation = approvalContinuations.get(pending);
    if (continuation === undefined || continuation.agent !== this) {
      throw new TypeError("Approval continuation does not belong to this agent.");
    }
    approvalContinuations.delete(pending);
    continuation.resolve(decision);
    return continuation.mode === "generate"
      ? (continuation.resume() as Promise<AgentResult<Output>>)
      : (continuation.resume() as AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>>);
  }

  session(sessionId: string, options: SessionOptions = {}): AgentSession<Output, M> {
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
      context.metadata = cloneFrozenPlainData(options.metadata);
    }
    return new AgentSession(this, context);
  }

  asTool(options: AgentToolOptions): Tool<{ prompt: string }, Output> {
    const description =
      options.description ?? this.description ?? `Prompt the ${options.name} agent.`;

    return createTool({
      name: options.name,
      description,
      inputSchema: z.object({
        prompt: z.string().describe("The prompt to send to the agent."),
      }),
      execute: async ({ prompt }, context: ToolCallContext) => {
        if (
          options.stream === true &&
          context.emitStreamEvent !== undefined &&
          this.model.capabilities.streaming &&
          isStreamingCompletionModel(this.model)
        ) {
          let completed = false;
          let output!: Output;
          const childStream = this.stream(prompt, {
            maxTurns: options.maxTurns,
            abortSignal: context.abortSignal,
          });
          for await (const event of childStream) {
            if (event.type === "approval_required") {
              await cancelAgentApproval(
                event,
                `Agent tool "${options.name}" cannot suspend for tool approval.`,
              );
              throw new Error(
                `Agent tool "${options.name}" cannot suspend for tool approval. Run the agent directly to handle approvals.`,
              );
            }
            const streamEvent: ToolCallStreamEvent = {
              agentId: this.id,
              event,
            };
            if (this.name !== undefined) {
              streamEvent.agentName = this.name;
            }
            await context.emitStreamEvent(streamEvent);
            if (event.type === "error") {
              throw event.error;
            }
            if (event.type === "final") {
              if (event.result.status === "blocked") {
                throw new AgentRunBlockedError(event.result);
              }
              output = event.result.output;
              completed = true;
            }
          }
          if (!completed) {
            throw new Error(`Agent tool "${options.name}" ended without a final result.`);
          }
          return output;
        }
        const response = await this.generate(prompt, {
          maxTurns: options.maxTurns,
          abortSignal: context.abortSignal,
        });
        if (response.status === "approval_required") {
          await cancelAgentApproval(
            response,
            `Agent tool "${options.name}" cannot suspend for tool approval.`,
          );
          throw new Error(
            `Agent tool "${options.name}" cannot suspend for tool approval. Run the agent directly to handle approvals.`,
          );
        }
        if (response.status === "blocked") {
          throw new AgentRunBlockedError(response);
        }
        return response.output;
      },
    });
  }

  getTool(toolName: string): AnyTool | undefined {
    return getRegisteredAgentTool(this, toolName);
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

    return prepareToolCall(tool, args).call(context ?? {});
  }
}

const resolvedAgentOptions = Symbol("resolvedAgentOptions");

type InternalAgentOptions<
  Output,
  M extends CompletionModel,
  ContextDocument,
> = ResolvedAgentOptions<Output, M, ContextDocument> & {
  [resolvedAgentOptions]: true;
};

export function createResolvedAgent<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
>(options: ResolvedAgentOptions<Output, M, ContextDocument>): Agent<Output, M, ContextDocument> {
  return new Agent({
    ...options,
    [resolvedAgentOptions]: true,
  } as unknown as AgentOptions<Output, M, ContextDocument>);
}

export function getResolvedAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  agent: Agent<Output, M, ContextDocument>,
): ResolvedAgentOptions<Output, M, ContextDocument> {
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
    providerOptions: agent.providerOptions,
    retries: agent.retries,
    tools: [...toolState.staticTools],
    providerTools: [...toolState.providerTools],
    toolIndexes: [...toolState.toolIndexes],
    toolChoice: agent.toolChoice,
    defaultMaxTurns: agent.defaultMaxTurns,
    lifecycle: agent.lifecycle,
    outputSchema: agent.outputSchema,
    observers: [...agent.observers],
    guardrails: [...agent.guardrails],
    middlewares: [...agent.middlewares],
    memory: agent.memory,
  };
}

export function getAgentProviderOutputSchema(agent: object): JsonObject | undefined {
  return providerOutputSchemas.get(agent);
}

function resolveAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
): ResolvedAgentOptions<Output, M, ContextDocument> {
  if (isInternalAgentOptions(options)) {
    return options as unknown as ResolvedAgentOptions<Output, M, ContextDocument>;
  }

  const toolsByName = new Map<string, AnyTool>();
  const providerTools: ProviderTool[] = [];
  const toolIndexes: ToolIndex[] = [];
  for (const tool of options.tools ?? []) {
    if (isProviderTool(tool)) {
      providerTools.push(tool);
    } else if (isToolIndex(tool)) {
      toolIndexes.push(tool);
    } else if ((tool as { kind?: unknown }).kind === "tool-index") {
      throw new TypeError("Invalid tool index: search, tools, and a numeric topK are required.");
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
    providerOptions: options.providerOptions,
    retries: options.retries,
    tools: [...toolsByName.values()],
    providerTools,
    toolIndexes,
    toolChoice: options.toolChoice,
    defaultMaxTurns: options.maxTurns,
    lifecycle: options.lifecycle,
    outputSchema: options.outputSchema,
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

function assertUniqueIndexedToolNames(indexes: readonly ToolIndex[]): void {
  const owners = new Map<string, number>();
  for (const [indexPosition, index] of indexes.entries()) {
    if (!isToolIndex(index)) {
      throw new TypeError("Invalid tool index: search, tools, and a numeric topK are required.");
    }
    assertPositiveSearchLimit(index.topK);
    assertFiniteMinScore(index.minScore);
    for (const tool of index.tools) {
      const existingPosition = owners.get(tool.name);
      if (existingPosition !== undefined) {
        if (existingPosition === indexPosition) {
          throw new TypeError(
            `Tool "${tool.name}" is registered more than once by tool index ${indexPosition + 1}. Tool names must be unique within each index.`,
          );
        }
        throw new TypeError(
          `Tool "${tool.name}" is registered by multiple tool indexes (${existingPosition + 1} and ${indexPosition + 1}). Tool names must be unique across indexes.`,
        );
      }
      owners.set(tool.name, indexPosition);
    }
  }
}

function assertValidVectorContexts(inputs: readonly AgentContextInput[]): void {
  for (const input of inputs) {
    if (!isVectorContext(input)) continue;
    assertPositiveSearchLimit(input.topK);
    assertFiniteMinScore(input.minScore);
  }
}

function isInternalAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
): boolean {
  return (
    (options as unknown as Partial<InternalAgentOptions<Output, M, ContextDocument>>)[
      resolvedAgentOptions
    ] === true
  );
}

function resolveAgentMemory<Output, M extends CompletionModel, ContextDocument>(
  options: AgentOptions<Output, M, ContextDocument>,
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

type GenerateExecution<Output = unknown> = {
  next(): Promise<AgentResult<Output>>;
  cancel(reason: string): Promise<void>;
};

type ApprovalContinuationBase = {
  agent: object;
  resolve(decision: AgentApprovalDecision): void;
  cancel(reason: string): Promise<void>;
};

type ApprovalContinuation = ApprovalContinuationBase &
  (
    | {
        mode: "generate";
        resume(): Promise<AgentResult<unknown>>;
      }
    | {
        mode: "stream";
        resume(): AgentStream<AgentStreamEvent<unknown, unknown>>;
      }
  );

const approvalContinuations = new WeakMap<object, ApprovalContinuation>();

function assertAgentApprovalDecision(decision: AgentApprovalDecision): void {
  if (typeof decision !== "object" || decision === null || typeof decision.approved !== "boolean") {
    throw new TypeError("Approval decision must include an approved boolean.");
  }
  if (decision.reason !== undefined && typeof decision.reason !== "string") {
    throw new TypeError("Approval decision reason must be a string.");
  }
}

function createGenerateExecution<Output, M extends CompletionModel>(
  agent: Agent<Output, M>,
  run: AgentRun<Output, M>,
): GenerateExecution<Output> {
  const completion = run.generate();
  const execution: GenerateExecution<Output> = {
    async next() {
      const outcome = await Promise.race([
        completion.then((result) => ({ type: "completed" as const, result })),
        run.waitForApproval().then(() => ({ type: "approval" as const })),
      ]);
      if (outcome.type === "completed") {
        return outcome.result;
      }
      const pending = run.approvalResult();
      approvalContinuations.set(pending, {
        agent,
        mode: "generate",
        resolve: (decision) => run.resolveApproval(decision),
        resume: () => execution.next(),
        cancel: (reason) => execution.cancel(reason),
      });
      return pending;
    },
    async cancel(reason) {
      run.cancel(reason);
      await completion.catch(() => undefined);
    },
  };
  return execution;
}

class StreamExecution<Output, M extends CompletionModel> {
  private readonly iterator: AsyncIterator<AgentStreamEvent<Output, RawResponseOf<M>>>;
  private nextEvent:
    | Promise<IteratorResult<AgentStreamEvent<Output, RawResponseOf<M>>>>
    | undefined;
  private phase: "active" | "approval" | "terminal" | "cancelled" = "active";

  constructor(
    private readonly agent: Agent<Output, M>,
    private readonly run: AgentRun<Output, M>,
  ) {
    this.iterator = run.events()[Symbol.asyncIterator]();
  }

  segment(): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
    if (this.phase === "approval") {
      this.phase = "active";
    }
    return new DefaultAgentStream(this);
  }

  steer(input: AgentInput): boolean {
    return this.run.steer(input);
  }

  async *events(): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    while (true) {
      this.nextEvent ??= this.iterator.next();
      let outcome:
        | {
            type: "event";
            event: IteratorResult<AgentStreamEvent<Output, RawResponseOf<M>>>;
          }
        | { type: "approval" };
      try {
        outcome = await Promise.race([
          this.nextEvent.then((event) => ({ type: "event" as const, event })),
          this.run.waitForApproval().then(() => ({ type: "approval" as const })),
        ]);
      } catch (error) {
        this.phase = "terminal";
        throw error;
      }
      if (outcome.type === "approval") {
        this.phase = "approval";
        const pending = this.run.approvalEvent();
        approvalContinuations.set(pending, {
          agent: this.agent,
          mode: "stream",
          resolve: (decision) => this.run.resolveApproval(decision),
          resume: () => this.segment(),
          cancel: (reason) => this.cancel(reason),
        });
        yield pending;
        return;
      }
      this.nextEvent = undefined;
      if (outcome.event.done) {
        this.phase = "terminal";
        return;
      }
      yield outcome.event.value;
    }
  }

  shouldCancelActiveSegment(): boolean {
    return this.phase === "active";
  }

  async cancel(reason: string): Promise<void> {
    if (this.phase === "terminal" || this.phase === "cancelled") {
      return;
    }
    this.phase = "cancelled";
    this.run.cancel(reason);
    try {
      await this.iterator.return?.();
    } catch {
      // Cancellation is best-effort; the run finalizes its observers and memory before rejecting.
    }
  }
}

function createStreamExecution<Output, M extends CompletionModel>(
  agent: Agent<Output, M>,
  run: AgentRun<Output, M>,
): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
  return new StreamExecution(agent, run).segment();
}

class DefaultAgentStream<Output, M extends CompletionModel>
  implements AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>>
{
  private consuming = false;
  private completed = false;

  constructor(private readonly execution: StreamExecution<Output, M>) {}

  steer(input: AgentInput): boolean {
    return this.execution.steer(input);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent<Output, RawResponseOf<M>>> {
    return this.consume()[Symbol.asyncIterator]();
  }

  private async *consume(): AsyncIterableIterator<AgentStreamEvent<Output, RawResponseOf<M>>> {
    if (this.completed) {
      throw new Error("Agent stream has already been consumed.");
    }
    if (this.consuming) {
      throw new Error("Agent stream is already running.");
    }
    this.consuming = true;
    try {
      for await (const event of this.execution.events()) {
        yield event;
      }
    } finally {
      if (this.execution.shouldCancelActiveSegment()) {
        await this.execution.cancel("Agent stream consumer closed the stream.");
      }
      this.consuming = false;
      this.completed = true;
    }
  }
}

export async function cancelAgentApproval(
  pending: AgentApprovalRequiredResult | AgentApprovalRequiredEvent,
  reason: string,
): Promise<void> {
  const continuation = approvalContinuations.get(pending);
  if (continuation === undefined) {
    return;
  }
  approvalContinuations.delete(pending);
  await continuation.cancel(reason);
}

export class AgentSession<Output = string, M extends CompletionModel = CompletionModel> {
  constructor(
    private readonly agent: Agent<Output, M>,
    private readonly context: {
      sessionId: string;
      userId?: string | undefined;
      metadata?: JsonObject | undefined;
    },
  ) {}

  generate(
    input: string | MessageType,
    options: AgentRunOptions<Output, RawResponseOf<M>> = {},
  ): Promise<AgentResult<Output>> {
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
    options: AgentRunOptions<Output, RawResponseOf<M>> = {},
  ): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
    if (Array.isArray(input)) {
      throw new TypeError("AgentSession.stream does not accept Message[] transcripts.");
    }
    if (!this.agent.model.capabilities.streaming || !isStreamingCompletionModel(this.agent.model)) {
      throw new Error("This completion model does not support streaming");
    }
    return createStreamExecution(
      this.agent,
      AgentRun.fromAgent(this.agent, input, { ...options, memoryContext: this.context }),
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

function snapshotContextInput<T>(input: AgentContextInput<T>): AgentContextInput<T> {
  if (!isVectorContext(input)) {
    return Object.freeze({
      id: input.id,
      text: input.text,
      ...(input.additionalProps === undefined
        ? {}
        : { additionalProps: cloneFrozenPlainData(input.additionalProps) }),
    });
  }
  const format = input.format;
  const shared = {
    kind: "vector-context" as const,
    store: input.store,
    topK: input.topK,
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
    ...(input.filter === undefined ? {} : { filter: cloneFrozenPlainData(input.filter) }),
    ...(input.retries === undefined ? {} : { retries: cloneFrozenPlainData(input.retries) }),
    ...(format === undefined
      ? {}
      : { format: (result: VectorSearchResult<T>) => format.call(input, result) }),
  };
  return Object.freeze<VectorContext<T>>(
    "models" in input && input.models !== undefined
      ? {
          ...shared,
          store: input.store,
          models: input.models,
          ...(input.fusion === undefined ? {} : { fusion: input.fusion }),
        }
      : { ...shared, store: input.store, model: input.model },
  );
}

function snapshotProviderTool(tool: ProviderTool): ProviderTool {
  return Object.freeze({
    ...tool,
    ...(tool.configuration === undefined
      ? {}
      : { configuration: cloneFrozenPlainData(tool.configuration) }),
  });
}

function snapshotToolIndex(index: ToolIndex): ToolIndex {
  const inspect = index.inspect;
  return Object.freeze({
    kind: "tool-index" as const,
    tools: Object.freeze([...index.tools]),
    topK: index.topK,
    ...(index.minScore === undefined ? {} : { minScore: index.minScore }),
    ...(index.filter === undefined ? {} : { filter: cloneFrozenPlainData(index.filter) }),
    search: (options: { query: string; abortSignal?: AbortSignal | undefined }) =>
      index.search(options),
    ...(inspect === undefined
      ? {}
      : { inspect: (request: VectorInspectRequest) => inspect.call(index, request) }),
  });
}

function snapshotGuardrailPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  return Object.freeze({
    ...policy,
    input: Object.freeze([...policy.input]),
    output: Object.freeze([...policy.output]),
  }) as GuardrailPolicy;
}

function snapshotMemoryRegistration(
  memory: MemoryRegistration | undefined,
): MemoryRegistration | undefined {
  if (memory === undefined) {
    return undefined;
  }
  const compaction =
    memory.options.compaction === undefined
      ? undefined
      : Object.freeze({ ...memory.options.compaction });
  return Object.freeze({
    store: memory.store,
    options: Object.freeze({
      ...memory.options,
      ...(compaction === undefined ? {} : { compaction }),
    }),
  });
}

function cloneFrozenPlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneFrozenPlainData)) as T;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const clone = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneFrozenPlainData(item)]),
  );
  return Object.freeze(clone) as T;
}

function dedupeTools(tools: readonly AnyTool[]): AnyTool[] {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
