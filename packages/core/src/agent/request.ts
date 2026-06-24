import {
  assertCompletionRequestSupported,
  type CompletionModel,
  CompletionRequestBuilder,
  type CompletionResponse,
  type JsonObject,
  Message,
  type Message as MessageType,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  textFromAssistantContent,
  Usage,
} from "../completion/index";
import { createAsyncQueue } from "../internal/async-queue";
import { compact } from "../internal/compact";
import type { MemoryContext } from "../memory";
import { type ActiveAgentRunObservers, startAgentRunObservers } from "../observability/group";
import type { AgentTraceOptions } from "../observability/types";
import { toReadableStream } from "../streaming";
import type { ToolApprovalsOptions } from "../tool";
import type { AgentMiddleware, ToolMiddleware } from "../tool/middleware";
import type { Agent } from "./agent";
import { MaxTurnsError, PromptCancelledError } from "./errors";
import type { PromptHook } from "./hooks";
import { runControl } from "./hooks";
import { PromptRequestMemory } from "./request-memory";
import {
  type AgentStreamEvent,
  addTurn,
  isGenerationDeltaEvent,
  type PromptResponse,
} from "./request-types";
import { fetchDynamicContext, fetchToolDefinitions } from "./retrieval";
import { CompletionStreamAccumulator } from "./stream-accumulator";
import {
  type AgentToolEventPayload,
  ToolCallExecutor,
  type ToolExecutionEventPayload,
  type ToolResultEventPayload,
} from "./tool-execution";
import { extractRagText, isStreamingCompletionModel } from "./utils";

export class PromptRequest<M extends CompletionModel = CompletionModel> {
  private chatHistory: MessageType[];
  private maxTurnCount: number;
  private activeHook: PromptHook | undefined;
  private approvalOptions: ToolApprovalsOptions | undefined;
  private concurrency = 1;
  private traceOptions: AgentTraceOptions | undefined;
  private requestMiddlewares: AgentMiddleware[] = [];
  private readonly steeringMessages: MessageType[] = [];
  private runState: "idle" | "running" | "completed" | "errored" | "cancelled" = "idle";
  private readonly memoryRecorder: PromptRequestMemory;

  private constructor(
    private readonly agent: Agent<M>,
    private readonly promptMessage: MessageType,
    initialHistory: MessageType[] = [],
    private readonly memoryContext: MemoryContext | undefined = undefined,
  ) {
    this.chatHistory = initialHistory;
    this.maxTurnCount = agent.defaultMaxTurns ?? 0;
    this.activeHook = agent.hook;
    this.approvalOptions = agent.approvals;
    this.memoryRecorder = new PromptRequestMemory(agent, memoryContext, initialHistory);
  }

  static fromAgent<M extends CompletionModel>(
    agent: Agent<M>,
    prompt: string | MessageType | MessageType[],
    options: { memoryContext?: MemoryContext | undefined } = {},
  ): PromptRequest<M> {
    const normalized = normalizePromptInput(prompt);
    return new PromptRequest(agent, normalized.prompt, normalized.history, options.memoryContext);
  }

  maxTurns(maxTurns: number): this {
    this.maxTurnCount = maxTurns;
    return this;
  }

  withHook(hook: PromptHook): this {
    this.activeHook = hook;
    return this;
  }

  approvals(options: ToolApprovalsOptions): this {
    this.approvalOptions = options;
    return this;
  }

  /**
   * @deprecated Use `withHook` instead.
   */
  requestHook(hook: PromptHook): this {
    return this.withHook(hook);
  }

  withToolConcurrency(concurrency: number): this {
    this.concurrency = Math.max(1, concurrency);
    return this;
  }

  withMiddleware(middleware: AgentMiddleware): this {
    this.requestMiddlewares.push(middleware);
    return this;
  }

  withMiddlewares(middlewares: AgentMiddleware[]): this {
    this.requestMiddlewares.push(...middlewares);
    return this;
  }

  /**
   * @deprecated Use `withMiddleware` instead.
   */
  withToolMiddleware(middleware: ToolMiddleware): this {
    return this.withMiddleware(middleware);
  }

  /**
   * @deprecated Use `withMiddlewares` instead.
   */
  withToolMiddlewares(middlewares: ToolMiddleware[]): this {
    return this.withMiddlewares(middlewares);
  }

  withTrace(trace: AgentTraceOptions): this {
    this.traceOptions = trace;
    return this;
  }

  steer(input: string | MessageType | MessageType[]): boolean {
    if (this.isTerminal()) {
      return false;
    }

    this.steeringMessages.push(...normalizeSteeringInput(input));
    return true;
  }

  async send(): Promise<PromptResponse> {
    this.startRun();
    const runId = globalThis.crypto.randomUUID();
    const newMessages: MessageType[] = [this.promptMessage];
    this.chatHistory = await this.memoryRecorder.prepareRun(runId, newMessages);
    const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    const runObservers = await this.startRunObservers();

    try {
      await this.runRunStartHook(newMessages);
      while (currentTurns <= this.maxTurnCount + 1) {
        const prompt = newMessages.at(-1);
        if (prompt === undefined) {
          throw new Error("PromptRequest requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];
        await this.runTurnStartHook(currentTurns, prompt, historyForRequest, newMessages);
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const ragText = extractRagText(prompt);
        const dynamicContext = await fetchDynamicContext(this.agent, ragText);
        const toolDefs = await fetchToolDefinitions(this.agent, ragText);
        let request = new CompletionRequestBuilder(this.agent.model, prompt)
          .instructions(this.agent.instructions)
          .messages(historyForRequest)
          .documents([...this.agent.staticContext, ...dynamicContext])
          .tools(toolDefs)
          .temperature(this.agent.temperature)
          .maxTokens(this.agent.maxTokens)
          .additionalParams(this.agent.additionalParams)
          .toolChoice(this.agent.toolChoice)
          .outputSchema(this.agent.outputSchema)
          .build();
        request = await this.runCompletionRequestMiddlewares(request, currentTurns);

        let response: CompletionResponse;
        try {
          response = await this.runCompletion(request, currentTurns, runObservers);
        } catch (error) {
          await this.runCompletionErrorHook(prompt, error, newMessages);
          throw error;
        }
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        usage = Usage.add(usage, response.usage);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);

        const assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage],
          pendingTurnMessages,
        );
        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        if (toolCalls.length === 0) {
          if (
            await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages)
          ) {
            await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
            continue;
          }

          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          const result: PromptResponse = {
            output: textFromAssistantContent(response.choice),
            usage,
            messages: [...newMessages],
            trace: runObservers.trace,
          };
          this.runState = "completed";
          await this.runRunEndHook(result, newMessages);
          await runObservers.end(result);
          return result;
        }

        const toolResults = await this.executeToolCalls(
          runId,
          toolCalls,
          newMessages,
          undefined,
          undefined,
          {
            turn: currentTurns,
            runObservers,
            toolDefinitions: request.tools,
          },
        );
        const toolMessage = Message.tool(toolResults);
        newMessages.push(toolMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [toolMessage],
          pendingTurnMessages,
        );
        await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages);
        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      const finalError = await this.runRunErrorHook(error, usage, newMessages);
      this.runState = finalError instanceof PromptCancelledError ? "cancelled" : "errored";
      await runObservers.error({ error: finalError, usage, messages: [...newMessages] });
      await this.memoryRecorder.recordError(runId, finalError, newMessages);
      throw finalError;
    }
  }

  async *stream(): AsyncIterable<AgentStreamEvent> {
    if (!this.agent.model.capabilities.streaming || !isStreamingCompletionModel(this.agent.model)) {
      throw new Error("This completion model does not support streaming");
    }

    this.startRun();
    const runId = globalThis.crypto.randomUUID();
    const newMessages: MessageType[] = [this.promptMessage];
    this.chatHistory = await this.memoryRecorder.prepareRun(runId, newMessages);
    const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    const runObservers = await this.startRunObservers();
    const emit = async (event: AgentStreamEvent): Promise<AgentStreamEvent> => {
      await this.recordAgentEvent(runId, event);
      return event;
    };

    try {
      await this.runRunStartHook(newMessages);
      while (currentTurns <= this.maxTurnCount + 1) {
        const prompt = newMessages.at(-1);
        if (prompt === undefined) {
          throw new Error("PromptRequest requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];
        yield await emit({
          type: "turn_start",
          turn: currentTurns,
          prompt,
          history: historyForRequest,
        });
        await this.runTurnStartHook(currentTurns, prompt, historyForRequest, newMessages);
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const ragText = extractRagText(prompt);
        const dynamicContext = await fetchDynamicContext(this.agent, ragText);
        const toolDefs = await fetchToolDefinitions(this.agent, ragText);
        let request = new CompletionRequestBuilder(this.agent.model, prompt)
          .instructions(this.agent.instructions)
          .messages(historyForRequest)
          .documents([...this.agent.staticContext, ...dynamicContext])
          .tools(toolDefs)
          .temperature(this.agent.temperature)
          .maxTokens(this.agent.maxTokens)
          .additionalParams(this.agent.additionalParams)
          .toolChoice(this.agent.toolChoice)
          .outputSchema(this.agent.outputSchema)
          .build();
        request = await this.runCompletionRequestMiddlewares(request, currentTurns);

        assertCompletionRequestSupported(this.agent.model, request, { streaming: true });
        const providerRequest = this.providerTraceRequest(request, { stream: true });
        const generationObservers = await runObservers.startGeneration(
          compact({
            turn: currentTurns,
            request,
            providerRequest,
            modelInfo: {
              provider: this.agent.model.provider,
              defaultModel: this.agent.model.defaultModel,
              capabilities: this.agent.model.capabilities,
            },
          }),
        );
        const accumulator = new CompletionStreamAccumulator();
        const generationStartedAt = Date.now();
        let firstDeltaMs: number | undefined;
        try {
          for await (const event of this.agent.model.streamCompletion(request)) {
            if (firstDeltaMs === undefined && isGenerationDeltaEvent(event.type)) {
              firstDeltaMs = Date.now() - generationStartedAt;
            }
            const mapped = accumulator.accept(event);
            if (event.type === "error") {
              throw event.error;
            }
            if (mapped !== undefined) {
              await generationObservers.update?.({ turn: currentTurns, delta: mapped });
              yield await emit(addTurn(currentTurns, mapped));
            }
          }
        } catch (error) {
          await generationObservers.error({ turn: currentTurns, error });
          await this.runCompletionErrorHook(prompt, error, newMessages);
          throw error;
        }

        let response = accumulator.response();
        await generationObservers.end(
          compact({
            turn: currentTurns,
            response,
            firstDeltaMs,
          }),
        );
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        usage = Usage.add(usage, response.usage);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);

        const assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage],
          pendingTurnMessages,
        );
        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        for (const toolCall of toolCalls) {
          yield await emit({ type: "tool_call", turn: currentTurns, toolCall });
        }
        yield await emit({ type: "turn_end", turn: currentTurns, response });

        if (toolCalls.length === 0) {
          if (
            await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages)
          ) {
            await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
            continue;
          }

          const output = textFromAssistantContent(response.choice);
          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          yield await emit({
            type: "final",
            runId,
            output,
            usage,
            messages: [...newMessages],
            trace: runObservers.trace,
          });
          this.runState = "completed";
          await this.runRunEndHook({ output, usage, messages: [...newMessages] }, newMessages);
          await runObservers.end({ output, usage, messages: [...newMessages] });
          return;
        }

        const toolResultEvents = createAsyncQueue<ToolExecutionEventPayload>();
        const toolResultsPromise = this.executeToolCalls(
          runId,
          toolCalls,
          newMessages,
          (result) => {
            toolResultEvents.enqueue(result);
          },
          (event) => {
            toolResultEvents.enqueue(event);
          },
          {
            turn: currentTurns,
            runObservers,
            toolDefinitions: request.tools,
          },
        );
        toolResultsPromise.then(
          () => toolResultEvents.close(),
          (error: unknown) => toolResultEvents.throw(error),
        );
        for await (const result of toolResultEvents) {
          yield await emit({ turn: currentTurns, ...result });
        }
        const toolResults = await toolResultsPromise;
        const toolMessage = Message.tool(toolResults);
        newMessages.push(toolMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [toolMessage],
          pendingTurnMessages,
        );
        await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages);
        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      const finalError = await this.runRunErrorHook(error, usage, newMessages);
      this.runState = finalError instanceof PromptCancelledError ? "cancelled" : "errored";
      await runObservers.error({ error: finalError, usage, messages: [...newMessages] });
      await this.memoryRecorder.recordError(runId, finalError, newMessages);
      yield await emit({ type: "error", error: finalError });
      throw finalError;
    }
  }

  readableStream(): ReadableStream<Uint8Array> {
    return toReadableStream(this.stream());
  }

  private async runCompletion(
    request: ReturnType<CompletionRequestBuilder["build"]>,
    turn: number,
    runObservers: ActiveAgentRunObservers,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this.agent.model, request);
    const providerRequest = this.providerTraceRequest(request);
    const generationObservers = await runObservers.startGeneration(
      compact({
        turn,
        request,
        providerRequest,
        modelInfo: {
          provider: this.agent.model.provider,
          defaultModel: this.agent.model.defaultModel,
          capabilities: this.agent.model.capabilities,
        },
      }),
    );
    try {
      const response = await this.agent.model.completion(request);
      await generationObservers.end({ turn, response });
      return response;
    } catch (error) {
      await generationObservers.error({ turn, error });
      throw error;
    }
  }

  private providerTraceRequest(
    request: ReturnType<CompletionRequestBuilder["build"]>,
    options: { stream?: boolean | undefined } = {},
  ): JsonObject | undefined {
    try {
      return this.agent.model.traceRequest?.(request, options);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeToolCalls(
    runId: string,
    toolCalls: ToolCall[],
    newMessages: MessageType[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: {
      turn: number;
      runObservers: ActiveAgentRunObservers;
      toolDefinitions?: ToolDefinition[];
    },
  ): Promise<ToolResult[]> {
    const executor = new ToolCallExecutor(
      this.agent,
      this.activeHook,
      this.approvalOptions,
      {
        runId,
        sessionId: this.memoryContext?.sessionId,
        metadata: this.memoryContext?.metadata,
      },
      this.concurrency,
      this.requestMiddlewares,
      (reason) => this.cancelled(newMessages, reason),
    );
    return executor.execute(toolCalls, onResult, onStreamEvent, observation);
  }

  private async startRunObservers(): Promise<ActiveAgentRunObservers> {
    const failOnObserverError =
      this.traceOptions?.failOnObserverError === true ||
      this.agent.observers.some((registration) => registration.failOnObserverError === true);
    return startAgentRunObservers(
      this.agent.observers,
      {
        agentName: this.agent.name,
        agentDescription: this.agent.description,
        instructions: this.agent.instructions,
        trace: this.traceOptions,
        prompt: this.promptMessage,
        history: this.chatHistory,
        maxTurns: this.maxTurnCount,
      },
      failOnObserverError,
    );
  }

  private async recordAgentEvent(runId: string, event: AgentStreamEvent): Promise<void> {
    const registration = this.agent.eventStore;
    if (registration === undefined) {
      return;
    }
    if (registration.options.include === "agent_tool_events" && event.type !== "agent_tool_event") {
      return;
    }

    const turn = "turn" in event ? event.turn : undefined;
    const agentId = event.type === "agent_tool_event" ? event.agentId : this.agent.id;
    const agentName = event.type === "agent_tool_event" ? event.agentName : this.agent.name;
    await registration.store.append({
      runId,
      agentId,
      ...compact({ agentName, turn }),
      ...(event.type === "agent_tool_event"
        ? compact({
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            internalCallId: event.internalCallId,
          })
        : {}),
      event,
    });
  }

  private async runCompletionCallHook(
    prompt: MessageType,
    history: MessageType[],
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onCompletionCall?.({
      prompt,
      history,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runRunStartHook(newMessages: MessageType[]): Promise<void> {
    const action = await this.activeHook?.onRunStart?.({
      prompt: this.promptMessage,
      history: this.chatHistory,
      maxTurns: this.maxTurnCount,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runRunEndHook(result: PromptResponse, newMessages: MessageType[]): Promise<void> {
    const action = await this.activeHook?.onRunEnd?.({
      output: result.output,
      usage: result.usage,
      messages: result.messages,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runRunErrorHook(
    error: unknown,
    usage: Usage,
    newMessages: MessageType[],
  ): Promise<unknown> {
    const action = await this.activeHook?.onRunError?.({
      error,
      usage,
      messages: [...this.chatHistory, ...newMessages],
      run: runControl,
    });
    if (action?.type === "terminate") {
      return this.cancelled(newMessages, action.reason);
    }
    return error;
  }

  private async runTurnStartHook(
    turn: number,
    prompt: MessageType,
    history: MessageType[],
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onTurnStart?.({
      turn,
      prompt,
      history,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runTurnEndHook(
    turn: number,
    response: CompletionResponse,
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onTurnEnd?.({
      turn,
      response,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runCompletionRequestMiddlewares(
    request: ReturnType<CompletionRequestBuilder["build"]>,
    turn: number,
  ): Promise<ReturnType<CompletionRequestBuilder["build"]>> {
    let current = request;
    for (const middleware of this.activeMiddlewares()) {
      const replacement = await middleware.onCompletionRequest?.({
        turn,
        request: current,
        originalRequest: request,
      });
      if (replacement?.request !== undefined) {
        current = replacement.request;
      }
    }
    return current;
  }

  private async runCompletionResponseMiddlewares(
    request: ReturnType<CompletionRequestBuilder["build"]>,
    response: CompletionResponse,
    turn: number,
  ): Promise<CompletionResponse> {
    let current = response;
    for (const middleware of this.activeMiddlewares()) {
      const replacement = await middleware.onCompletionResponse?.({
        turn,
        request,
        response: current,
        originalResponse: response,
      });
      if (replacement?.response !== undefined) {
        current = replacement.response;
      }
    }
    return current;
  }

  private async runCompletionResponseHook(
    prompt: MessageType,
    response:
      | Awaited<ReturnType<M["completion"]>>
      | Awaited<ReturnType<CompletionModel["completion"]>>,
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onCompletionResponse?.({
      prompt,
      response,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private async runCompletionErrorHook(
    prompt: MessageType,
    error: unknown,
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onCompletionError?.({
      prompt,
      error,
      run: runControl,
    });
    if (action?.type === "terminate") {
      throw this.cancelled(newMessages, action.reason);
    }
  }

  private activeMiddlewares(): AgentMiddleware[] {
    return [...this.agent.middlewares, ...this.requestMiddlewares];
  }

  private async drainSteeringMessages(
    runId: string,
    turn: number,
    newMessages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<boolean> {
    const messages = this.steeringMessages.splice(0);
    if (messages.length === 0) {
      return false;
    }

    newMessages.push(...messages);
    await this.memoryRecorder.commitMessages(runId, turn, messages, pendingTurnMessages);
    return true;
  }

  private startRun(): void {
    if (!this.isTerminal()) {
      this.runState = "running";
    }
  }

  private isTerminal(): boolean {
    return (
      this.runState === "completed" || this.runState === "errored" || this.runState === "cancelled"
    );
  }

  private cancelled(newMessages: MessageType[], reason: string): PromptCancelledError {
    return new PromptCancelledError([...this.chatHistory, ...newMessages], reason);
  }
}

function normalizePromptInput(prompt: string | MessageType | MessageType[]): {
  prompt: MessageType;
  history: MessageType[];
} {
  if (typeof prompt === "string") {
    return { prompt: Message.user(prompt), history: [] };
  }
  if (!Array.isArray(prompt)) {
    return { prompt, history: [] };
  }
  if (prompt.length === 0) {
    throw new TypeError("Prompt transcript must contain at least one message.");
  }
  const activePrompt = prompt.at(-1);
  if (activePrompt === undefined) {
    throw new TypeError("Prompt transcript must contain at least one message.");
  }
  return {
    prompt: activePrompt,
    history: prompt.slice(0, -1),
  };
}

function normalizeSteeringInput(input: string | MessageType | MessageType[]): MessageType[] {
  if (typeof input === "string") {
    return [Message.user(input)];
  }
  return Array.isArray(input) ? [...input] : [input];
}
