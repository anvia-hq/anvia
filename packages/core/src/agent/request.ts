import {
  assertCompletionRequestSupported,
  type CompletionModel,
  CompletionRequestBuilder,
  type CompletionResponse,
  type Document,
  Message,
  type Message as MessageType,
  type ReasoningContentType,
  type ToolCall,
  ToolContent,
  type ToolDefinition,
  type ToolResult,
  textFromAssistantContent,
  Usage,
} from "../completion/index";
import type { MemoryContext, MemoryRegistration, MemorySavePolicy } from "../memory";
import {
  type ActiveAgentRunObservers,
  type ActiveToolObservers,
  startAgentRunObservers,
} from "../observability/group";
import type { AgentTraceInfo, AgentTraceOptions } from "../observability/types";
import { toReadableStream } from "../streaming";
import type { ToolCallStreamEvent } from "../tool";
import type { ToolMiddleware, ToolResultMiddlewareArgs } from "../tool/middleware";
import type { Agent } from "./agent";
import { MaxTurnsError, PromptCancelledError } from "./errors";
import type { PromptHook, ToolHookArgs } from "./hooks";
import { runControl, toolCallControl } from "./hooks";
import { type AgentDeltaEvent, CompletionStreamAccumulator } from "./stream-accumulator";
import { extractRagText, isStreamingCompletionModel, mapWithConcurrency } from "./utils";

export type PromptResponse = {
  output: string;
  usage: Usage;
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
};

export type AgentChildStreamEvent<RawResponse = unknown> =
  | {
      type: "turn_start";
      turn: number;
      prompt: MessageType;
      history: MessageType[];
    }
  | {
      type: "text_delta";
      turn: number;
      delta: string;
    }
  | {
      type: "reasoning_delta";
      turn: number;
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "tool_call";
      turn: number;
      toolCall: ToolCall;
    }
  | {
      type: "tool_result";
      turn: number;
      toolName: string;
      toolCallId?: string;
      internalCallId: string;
      args: string;
      result: string;
    }
  | {
      type: "turn_end";
      turn: number;
      response: CompletionResponse<RawResponse>;
    }
  | {
      type: "final";
      runId: string;
      output: string;
      usage: Usage;
      messages: MessageType[];
      trace?: AgentTraceInfo | undefined;
    }
  | {
      type: "error";
      error: unknown;
    };

export type AgentStreamEvent<RawResponse = unknown> =
  | AgentChildStreamEvent<RawResponse>
  | {
      type: "agent_tool_event";
      turn: number;
      toolName: string;
      toolCallId?: string;
      internalCallId: string;
      agentId: string;
      agentName?: string;
      event: AgentChildStreamEvent<RawResponse>;
    };

export class PromptRequest<M extends CompletionModel = CompletionModel> {
  private chatHistory: MessageType[];
  private maxTurnCount: number;
  private activeHook: PromptHook | undefined;
  private concurrency = 1;
  private traceOptions: AgentTraceOptions | undefined;
  private requestToolMiddlewares: ToolMiddleware[] = [];

  private constructor(
    private readonly agent: Agent<M>,
    private readonly promptMessage: MessageType,
    private readonly initialHistory: MessageType[] = [],
    private readonly memoryContext: MemoryContext | undefined = undefined,
  ) {
    this.chatHistory = initialHistory;
    this.maxTurnCount = agent.defaultMaxTurns ?? 0;
    this.activeHook = agent.hook;
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

  requestHook(hook: PromptHook): this {
    this.activeHook = hook;
    return this;
  }

  withToolConcurrency(concurrency: number): this {
    this.concurrency = Math.max(1, concurrency);
    return this;
  }

  withToolMiddleware(middleware: ToolMiddleware): this {
    this.requestToolMiddlewares.push(middleware);
    return this;
  }

  withToolMiddlewares(middlewares: ToolMiddleware[]): this {
    this.requestToolMiddlewares.push(...middlewares);
    return this;
  }

  withTrace(trace: AgentTraceOptions): this {
    this.traceOptions = trace;
    return this;
  }

  async send(): Promise<PromptResponse> {
    const runId = globalThis.crypto.randomUUID();
    const newMessages: MessageType[] = [this.promptMessage];
    await this.prepareMemoryRun(runId, newMessages);
    const pendingTurnMessages = this.memoryPolicy() === "turn" ? [...newMessages] : [];
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    const runObservers = await this.startRunObservers();

    try {
      while (currentTurns <= this.maxTurnCount + 1) {
        const prompt = newMessages.at(-1);
        if (prompt === undefined) {
          throw new Error("PromptRequest requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const ragText = extractRagText(prompt);
        const dynamicContext = await this.fetchDynamicContext(ragText);
        const toolDefs = await this.fetchToolDefinitions(ragText);
        const request = new CompletionRequestBuilder(this.agent.model, prompt)
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

        const response = await this.runCompletion(request, currentTurns, runObservers);
        usage = Usage.add(usage, response.usage);
        await this.runCompletionResponseHook(prompt, response, newMessages);

        const assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);
        await this.commitMemoryMessages(
          runId,
          currentTurns,
          [assistantMessage],
          pendingTurnMessages,
        );
        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        if (toolCalls.length === 0) {
          await this.commitCompletedMemoryRun(
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
          await runObservers.end(result);
          return result;
        }

        const toolResults = await this.executeToolCalls(
          toolCalls,
          newMessages,
          undefined,
          undefined,
          {
            turn: currentTurns,
            runObservers,
          },
        );
        const toolMessage = Message.tool(toolResults);
        newMessages.push(toolMessage);
        await this.commitMemoryMessages(runId, currentTurns, [toolMessage], pendingTurnMessages);
        await this.commitCompletedMemoryTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      await runObservers.error({ error, usage, messages: [...newMessages] });
      await this.recordMemoryError(runId, error, newMessages);
      throw error;
    }
  }

  async *stream(): AsyncIterable<AgentStreamEvent> {
    if (!this.agent.model.capabilities.streaming || !isStreamingCompletionModel(this.agent.model)) {
      throw new Error("This completion model does not support streaming");
    }

    const runId = globalThis.crypto.randomUUID();
    const newMessages: MessageType[] = [this.promptMessage];
    await this.prepareMemoryRun(runId, newMessages);
    const pendingTurnMessages = this.memoryPolicy() === "turn" ? [...newMessages] : [];
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    const runObservers = await this.startRunObservers();
    const emit = async (event: AgentStreamEvent): Promise<AgentStreamEvent> => {
      await this.recordAgentEvent(runId, event);
      return event;
    };

    try {
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
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const ragText = extractRagText(prompt);
        const dynamicContext = await this.fetchDynamicContext(ragText);
        const toolDefs = await this.fetchToolDefinitions(ragText);
        const request = new CompletionRequestBuilder(this.agent.model, prompt)
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

        assertCompletionRequestSupported(this.agent.model, request, { streaming: true });
        const generationObservers = await runObservers.startGeneration({
          turn: currentTurns,
          request,
        });
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
              yield await emit(addTurn(currentTurns, mapped));
            }
          }
        } catch (error) {
          await generationObservers.error({ turn: currentTurns, error });
          throw error;
        }

        const response = accumulator.response();
        await generationObservers.end({
          turn: currentTurns,
          response,
          ...(firstDeltaMs === undefined ? {} : { firstDeltaMs }),
        });
        usage = Usage.add(usage, response.usage);
        await this.runCompletionResponseHook(prompt, response, newMessages);

        const assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);
        await this.commitMemoryMessages(
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
          const output = textFromAssistantContent(response.choice);
          await this.commitCompletedMemoryRun(
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
          await runObservers.end({ output, usage, messages: [...newMessages] });
          return;
        }

        const toolResultEvents = createAsyncQueue<ToolExecutionEventPayload>();
        const toolResultsPromise = this.executeToolCalls(
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
        await this.commitMemoryMessages(runId, currentTurns, [toolMessage], pendingTurnMessages);
        await this.commitCompletedMemoryTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      await runObservers.error({ error, usage, messages: [...newMessages] });
      await this.recordMemoryError(runId, error, newMessages);
      yield await emit({ type: "error", error });
      throw error;
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
    const generationObservers = await runObservers.startGeneration({ turn, request });
    try {
      const response = await this.agent.model.completion(request);
      await generationObservers.end({ turn, response });
      return response;
    } catch (error) {
      await generationObservers.error({ turn, error });
      throw error;
    }
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    newMessages: MessageType[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: {
      turn: number;
      runObservers: ActiveAgentRunObservers;
    },
  ): Promise<ToolResult[]> {
    return mapWithConcurrency(toolCalls, this.concurrency, async (toolCall) => {
      const args = JSON.stringify(toolCall.function.arguments ?? {});
      const internalCallId = globalThis.crypto.randomUUID();
      const hookArgs: ToolHookArgs = {
        toolName: toolCall.function.name,
        internalCallId,
        args,
      };
      if (toolCall.callId !== undefined) {
        hookArgs.toolCallId = toolCall.callId;
      }

      const toolObservers = await observation?.runObservers.startTool({
        turn: observation.turn,
        toolCall,
        toolName: toolCall.function.name,
        internalCallId,
        args,
        toolCallId: toolCall.callId,
      });

      const callAction = await this.activeHook?.onToolCall?.({
        ...hookArgs,
        tool: toolCallControl,
      });
      if (callAction?.type === "terminate") {
        await this.recordToolError(
          toolObservers,
          observation?.turn,
          toolCall,
          internalCallId,
          args,
          callAction.reason,
        );
        throw this.cancelled(newMessages, callAction.reason);
      }
      if (callAction?.type === "approval_request") {
        const reason = `Tool approval was requested for ${toolCall.function.name}, but no approval handler is installed.`;
        await this.recordToolError(
          toolObservers,
          observation?.turn,
          toolCall,
          internalCallId,
          args,
          reason,
        );
        throw this.cancelled(newMessages, reason);
      }

      let output: string;
      let skipped = false;
      if (callAction?.type === "skip") {
        output = callAction.reason;
        skipped = true;
      } else {
        try {
          output = await this.agent.callTool(toolCall.function.name, args, {
            emitStreamEvent: async (event) => {
              await toolObservers?.streamEvent({
                turn: observation?.turn ?? 0,
                toolCall,
                toolName: toolCall.function.name,
                internalCallId,
                args,
                ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
                event,
              });
              const payload = agentToolEventPayload(toolCall, internalCallId, event);
              if (payload !== undefined) {
                onStreamEvent?.(payload);
              }
            },
          });
        } catch (error) {
          output = error instanceof Error ? error.toString() : String(error);
        }
      }

      if (this.agent.shouldApplyToolMiddleware(toolCall.function.name)) {
        output = await this.runToolResultMiddlewares({
          ...hookArgs,
          result: output,
          originalResult: output,
          turn: observation?.turn ?? 0,
        });
      }

      const resultAction = await this.activeHook?.onToolResult?.({
        ...hookArgs,
        result: output,
        run: runControl,
      });
      await toolObservers?.end({
        turn: observation?.turn ?? 0,
        toolCall,
        toolName: toolCall.function.name,
        internalCallId,
        args,
        result: output,
        skipped,
        toolCallId: toolCall.callId,
      });
      if (resultAction?.type === "terminate") {
        throw this.cancelled(newMessages, resultAction.reason);
      }

      const resultPayload: ToolResultEventPayload = {
        type: "tool_result",
        toolName: toolCall.function.name,
        internalCallId,
        args,
        result: output,
      };
      if (toolCall.callId !== undefined) {
        resultPayload.toolCallId = toolCall.callId;
      }
      onResult?.(resultPayload);
      return ToolContent.toolResult(toolCall.id, output, toolCall.callId);
    });
  }

  private async runToolResultMiddlewares(args: ToolResultMiddlewareArgs): Promise<string> {
    let result = args.result;
    for (const middleware of [...this.agent.toolMiddlewares, ...this.requestToolMiddlewares]) {
      const replacement = await middleware.onResult?.({
        ...args,
        result,
      });
      if (replacement !== undefined) {
        result = replacement;
      }
    }
    return result;
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
      ...(agentName === undefined ? {} : { agentName }),
      ...(turn === undefined ? {} : { turn }),
      ...(event.type === "agent_tool_event"
        ? {
            toolName: event.toolName,
            ...(event.toolCallId === undefined ? {} : { toolCallId: event.toolCallId }),
            internalCallId: event.internalCallId,
          }
        : {}),
      event,
    });
  }

  private async fetchDynamicContext(ragText: string | undefined): Promise<Document[]> {
    if (ragText === undefined || ragText.length === 0 || this.agent.dynamicContexts.length === 0) {
      return [];
    }

    const documents: Document[] = [];
    for (const registration of this.agent.dynamicContexts) {
      const results = await registration.index.search({
        query: ragText,
        topK: registration.options.topK,
        threshold: registration.options.threshold,
        filter: registration.options.filter,
      });
      for (const result of results) {
        const formatted = registration.options.format?.(result);
        if (formatted !== undefined) {
          documents.push(formatted);
        } else {
          const metadata = formatMetadata(result.metadata);
          documents.push({
            id: result.id,
            text:
              typeof result.document === "string"
                ? result.document
                : JSON.stringify(result.document, null, 2),
            ...(metadata === undefined ? {} : { additionalProps: metadata }),
          });
        }
      }
    }
    return documents;
  }

  private async fetchToolDefinitions(ragText: string | undefined): Promise<ToolDefinition[]> {
    const staticDefinitions = await this.agent.toolSet.getToolDefinitions(ragText);
    if (ragText === undefined || ragText.length === 0 || this.agent.dynamicTools.length === 0) {
      return staticDefinitions;
    }

    const definitions = [...staticDefinitions];
    const names = new Set(staticDefinitions.map((definition) => definition.name));
    for (const registration of this.agent.dynamicTools) {
      const results = await registration.index.search({
        query: ragText,
        topK: registration.options.topK,
        threshold: registration.options.threshold,
        filter: registration.options.filter,
      });
      for (const result of results) {
        if (names.has(result.document.toolName)) {
          continue;
        }
        names.add(result.document.toolName);
        definitions.push(result.document.definition);
      }
    }
    return definitions;
  }

  private async recordToolError(
    toolObservers: ActiveToolObservers | undefined,
    turn: number | undefined,
    toolCall: ToolCall,
    internalCallId: string,
    args: string,
    error: unknown,
  ): Promise<void> {
    await toolObservers?.error({
      turn: turn ?? 0,
      toolCall,
      toolName: toolCall.function.name,
      internalCallId,
      args,
      error,
      toolCallId: toolCall.callId,
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

  private cancelled(newMessages: MessageType[], reason: string): PromptCancelledError {
    return new PromptCancelledError([...this.chatHistory, ...newMessages], reason);
  }

  private memory(): MemoryRegistration | undefined {
    return this.memoryContext === undefined ? undefined : this.agent.memory;
  }

  private memoryPolicy(): MemorySavePolicy | undefined {
    return this.memory()?.options.savePolicy;
  }

  private async prepareMemoryRun(runId: string, newMessages: MessageType[]): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      this.chatHistory = this.initialHistory;
      return;
    }

    const memoryHistory = await memory.store.load(this.memoryContext);
    this.chatHistory = [...memoryHistory, ...this.initialHistory];
    if (memory.options.savePolicy === "message") {
      await memory.store.append({
        context: this.memoryContext,
        runId,
        turn: 1,
        messages: newMessages,
      });
    }
  }

  private async commitMemoryMessages(
    runId: string,
    turn: number,
    messages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined || messages.length === 0) {
      return;
    }
    if (memory.options.savePolicy === "message") {
      await memory.store.append({
        context: this.memoryContext,
        runId,
        turn,
        messages,
      });
    } else if (memory.options.savePolicy === "turn") {
      pendingTurnMessages.push(...messages);
    }
  }

  private async commitCompletedMemoryTurn(
    runId: string,
    turn: number,
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "turn" ||
      pendingTurnMessages.length === 0
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
      runId,
      turn,
      messages: [...pendingTurnMessages],
    });
    pendingTurnMessages.length = 0;
  }

  private async commitCompletedMemoryRun(
    runId: string,
    turn: number,
    newMessages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    await this.commitCompletedMemoryTurn(runId, turn, pendingTurnMessages);
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "run"
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
      runId,
      turn,
      messages: [...newMessages],
    });
  }

  private async recordMemoryError(
    runId: string,
    error: unknown,
    newMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      return;
    }
    await memory.store.recordError?.({
      context: this.memoryContext,
      runId,
      error,
      messages: [...newMessages],
    });
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

type ToolResultEventPayload = {
  type: "tool_result";
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  args: string;
  result: string;
};

type AgentToolEventPayload = {
  type: "agent_tool_event";
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  agentId: string;
  agentName?: string;
  event: AgentChildStreamEvent;
};

type ToolExecutionEventPayload = ToolResultEventPayload | AgentToolEventPayload;

function agentToolEventPayload(
  toolCall: ToolCall,
  internalCallId: string,
  event: ToolCallStreamEvent,
): AgentToolEventPayload | undefined {
  if (typeof event.agentId !== "string" || event.agentId.length === 0) {
    return undefined;
  }
  return {
    type: "agent_tool_event",
    toolName: toolCall.function.name,
    ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
    internalCallId,
    agentId: event.agentId,
    ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
    event: event.event as AgentChildStreamEvent,
  };
}

type AsyncQueueWaiter<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
};

function createAsyncQueue<T>(): AsyncIterable<T> & {
  enqueue(value: T): void;
  close(): void;
  throw(error: unknown): void;
} {
  const values: T[] = [];
  const waiters: AsyncQueueWaiter<T>[] = [];
  let closed = false;
  let error: unknown;

  function flush(): void {
    while (waiters.length > 0 && values.length > 0) {
      const waiter = waiters.shift();
      const value = values.shift() as T;
      if (waiter !== undefined) {
        waiter.resolve({ value, done: false });
      }
    }

    if (values.length > 0 || waiters.length === 0 || !closed) {
      return;
    }

    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      if (error !== undefined) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  return {
    enqueue(value: T): void {
      if (closed) {
        return;
      }
      values.push(value);
      flush();
    },
    close(): void {
      closed = true;
      flush();
    },
    throw(thrown: unknown): void {
      closed = true;
      error = thrown;
      flush();
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (values.length > 0) {
            const value = values.shift() as T;
            return Promise.resolve({ value, done: false });
          }
          if (error !== undefined) {
            return Promise.reject(error);
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
      };
    },
  };
}

function addTurn(turn: number, event: AgentDeltaEvent): AgentStreamEvent {
  if (event.type === "text_delta") {
    return { type: "text_delta", turn, delta: event.delta };
  }
  if (event.type === "reasoning_delta") {
    const mapped: AgentStreamEvent = { type: "reasoning_delta", turn, delta: event.delta };
    if (event.id !== undefined) mapped.id = event.id;
    if (event.contentType !== undefined) mapped.contentType = event.contentType;
    if (event.signature !== undefined) mapped.signature = event.signature;
    return mapped;
  }
  return { type: "tool_call", turn, toolCall: event.toolCall };
}

function isGenerationDeltaEvent(type: string): boolean {
  return (
    type === "text_delta" ||
    type === "reasoning_delta" ||
    type === "tool_call_delta" ||
    type === "tool_call"
  );
}

function formatMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}
