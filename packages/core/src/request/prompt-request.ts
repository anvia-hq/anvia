import type { Agent } from "../agent/agent";
import type { AgentEventAppendInput } from "../agent/types";
import { isStreamingCompletionModel } from "../completion/create-completion";
import {
  AssistantContent,
  assertCompletionRequestSupported,
  type CompletionModel,
  CompletionRequestBuilder,
  type CompletionResponse,
  type JsonObject,
  type JsonValue,
  Message,
  type Message as MessageType,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  textFromAssistantContent,
  Usage,
} from "../completion/index";
import {
  appendGuardrailPolicies,
  type GuardrailDecisionRecord,
  type GuardrailPolicy,
  type GuardrailPolicyInput,
  type GuardrailRunContext,
  hasEnforcedOutputGuardrails,
  runInputGuardrails,
  runOutputGuardrails,
} from "../guardrails";
import type { PromptHook } from "../hooks";
import { runControl } from "../hooks";
import { createAsyncQueue } from "../internal/async-queue";
import { PromptRequestMemory } from "../internal/prompt-runtime/memory";
import { fetchDynamicContext, fetchToolDefinitions } from "../internal/prompt-runtime/retrieval";
import { CompletionStreamAccumulator } from "../internal/prompt-runtime/stream-accumulator";
import { addTurn, isGenerationDeltaEvent } from "../internal/prompt-runtime/stream-events";
import {
  type AgentToolEventPayload,
  ToolCallExecutor,
  type ToolExecutionEventPayload,
  type ToolResultEventPayload,
} from "../internal/prompt-runtime/tool-execution";
import { extractRagText } from "../internal/rag-text";
import type { MemoryContext } from "../memory/types";
import { type ActiveAgentRunObservers, startAgentRunObservers } from "../observability/group";
import type {
  AgentGenerationEndArgs,
  AgentGenerationStartArgs,
  AgentTraceOptions,
} from "../observability/types";
import { toReadableStream } from "../streaming";
import type { ToolApprovalsOptions } from "../tool";
import type { AgentMiddleware, ToolMiddleware } from "../tool/middleware";
import { MaxTurnsError, PromptCancelledError } from "./errors";
import type { AgentStreamEvent, PromptResponse } from "./types";

export class PromptRequest<M extends CompletionModel = CompletionModel> {
  private chatHistory: MessageType[];
  private maxTurnCount: number;
  private activeHook: PromptHook | undefined;
  private approvalOptions: ToolApprovalsOptions | undefined;
  private guardrailPolicies: GuardrailPolicy[];
  private guardrailDecisions: GuardrailDecisionRecord[] = [];
  private concurrency = 1;
  private traceOptions: AgentTraceOptions | undefined;
  private requestMiddlewares: AgentMiddleware[] = [];
  private readonly steeringMessages: MessageType[] = [];
  private runState: "idle" | "running" | "completed" | "errored" | "cancelled" = "idle";
  private readonly memoryRecorder: PromptRequestMemory;

  private constructor(
    private readonly agent: Agent<M>,
    private promptMessage: MessageType,
    initialHistory: MessageType[] = [],
    private readonly memoryContext: MemoryContext | undefined = undefined,
  ) {
    this.chatHistory = initialHistory;
    this.maxTurnCount = agent.defaultMaxTurns ?? 0;
    this.activeHook = agent.hook;
    this.approvalOptions = agent.approvals;
    this.guardrailPolicies = [...agent.guardrails];
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

  guardrails(policies: GuardrailPolicyInput): this {
    this.guardrailPolicies = appendGuardrailPolicies(this.guardrailPolicies, policies);
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
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    const runObservers = await this.startRunObservers();

    try {
      const inputResult = await runInputGuardrails(this.guardrailPolicies, {
        prompt: this.promptMessage,
        history: this.chatHistory,
        inputText: textFromMessage(this.promptMessage),
        run: this.guardrailRunContext(runId),
      });
      for (const decision of inputResult.decisions) {
        await this.recordGuardrailDecision(decision, runObservers);
      }
      this.promptMessage = inputResult.prompt;
      if (inputResult.blocked) {
        const output = inputResult.message ?? "The request was blocked by a guardrail.";
        const result: PromptResponse = {
          output,
          usage: Usage.empty(),
          messages: [this.promptMessage, Message.assistant(output)],
          guardrails: [...this.guardrailDecisions],
        };
        await runObservers.end(result);
        this.runState = "completed";
        return result;
      }

      newMessages = [this.promptMessage];
      this.chatHistory = await this.memoryRecorder.prepareRun(runId, newMessages);
      const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
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
        request = (await this.runCompletionRequestMiddlewares(
          request,
          currentTurns,
        )) as typeof request;

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

        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        const assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);
        if (toolCalls.length === 0) {
          if (this.steeringMessages.length > 0) {
            await this.memoryRecorder.commitMessages(
              runId,
              currentTurns,
              [assistantMessage],
              pendingTurnMessages,
            );
          }
          if (
            await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages)
          ) {
            await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
            continue;
          }

          const guardedOutput = await this.runOutputGuardrailsForResponse(
            runId,
            usage,
            response,
            newMessages,
            runObservers,
          );
          response = guardedOutput.response;
          const finalAssistantMessage = Message.assistant(response.choice, response.messageId);
          newMessages[newMessages.length - 1] = finalAssistantMessage;
          await this.memoryRecorder.commitMessages(
            runId,
            currentTurns,
            [finalAssistantMessage],
            pendingTurnMessages,
          );
          const result: PromptResponse = {
            output: guardedOutput.output,
            usage,
            messages: [...newMessages],
            trace: runObservers.trace,
            guardrails: [...this.guardrailDecisions],
          };
          await this.runRunEndHook(result, newMessages);
          await runObservers.end(result);
          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          this.runState = "completed";
          return result;
        }

        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage],
          pendingTurnMessages,
        );
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
    const emit = async (event: AgentStreamEvent): Promise<AgentStreamEvent> => {
      await this.recordAgentEvent(runId, event);
      return event;
    };
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    const runObservers = await this.startRunObservers();
    const bufferOutputDeltas = hasEnforcedOutputGuardrails(this.guardrailPolicies);

    try {
      const inputResult = await runInputGuardrails(this.guardrailPolicies, {
        prompt: this.promptMessage,
        history: this.chatHistory,
        inputText: textFromMessage(this.promptMessage),
        run: this.guardrailRunContext(runId),
      });
      for (const decision of inputResult.decisions) {
        await this.recordGuardrailDecision(decision, runObservers);
        yield await emit({ type: "guardrail_decision", decision });
      }
      this.promptMessage = inputResult.prompt;
      if (inputResult.blocked) {
        const output = inputResult.message ?? "The request was blocked by a guardrail.";
        const result: PromptResponse = {
          output,
          usage: Usage.empty(),
          messages: [this.promptMessage, Message.assistant(output)],
          guardrails: [...this.guardrailDecisions],
        };
        await runObservers.end(result);
        this.runState = "completed";
        yield await emit({
          type: "final",
          runId,
          output: result.output,
          usage: result.usage,
          messages: result.messages,
          guardrails: result.guardrails,
        });
        return;
      }

      newMessages = [this.promptMessage];
      this.chatHistory = await this.memoryRecorder.prepareRun(runId, newMessages);
      const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
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
        request = (await this.runCompletionRequestMiddlewares(
          request,
          currentTurns,
        )) as typeof request;

        assertCompletionRequestSupported(this.agent.model, request, { streaming: true });
        const providerRequest = this.providerTraceRequest(request, { stream: true });
        const generationObservers = await runObservers.startGeneration(
          this.generationStartArgs(currentTurns, request, providerRequest),
        );
        const accumulator = new CompletionStreamAccumulator();
        const generationStartedAt = Date.now();
        let firstDeltaMs: number | undefined;
        const bufferResponseEvents = this.shouldBufferStreamResponseEvents();
        const emittedToolCallIds = new Set<string>();
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
              if (mapped.type === "tool_call") {
                emittedToolCallIds.add(mapped.toolCall.id);
              }
              const shouldBuffer =
                bufferResponseEvents ||
                (bufferOutputDeltas &&
                  (mapped.type === "text_delta" || mapped.type === "reasoning_delta"));
              if (!shouldBuffer) {
                yield await emit(addTurn(currentTurns, mapped));
              }
            }
          }
        } catch (error) {
          await generationObservers.error({ turn: currentTurns, error });
          await this.runCompletionErrorHook(prompt, error, newMessages);
          throw error;
        }

        let response = accumulator.response();
        const generationEndArgs: AgentGenerationEndArgs = {
          turn: currentTurns,
          response,
        };
        if (firstDeltaMs !== undefined) {
          generationEndArgs.firstDeltaMs = firstDeltaMs;
        }
        await generationObservers.end(generationEndArgs);
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        usage = Usage.add(usage, response.usage);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);

        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        let assistantMessage = Message.assistant(response.choice, response.messageId);
        newMessages.push(assistantMessage);

        if (toolCalls.length === 0) {
          let emittedTurnEnd = false;
          if (!bufferOutputDeltas) {
            if (bufferResponseEvents) {
              for (const event of responseStreamEvents(currentTurns, response)) {
                yield await emit(event);
              }
            }
            yield await emit({ type: "turn_end", turn: currentTurns, response });
            emittedTurnEnd = true;
          }
          if (this.steeringMessages.length > 0) {
            await this.memoryRecorder.commitMessages(
              runId,
              currentTurns,
              [assistantMessage],
              pendingTurnMessages,
            );
          }
          if (
            await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages)
          ) {
            await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
            continue;
          }

          const guardedOutput = await this.runOutputGuardrailsForResponse(
            runId,
            usage,
            response,
            newMessages,
            runObservers,
          );
          for (const decision of guardedOutput.decisions) {
            yield await emit({ type: "guardrail_decision", decision });
          }
          response = guardedOutput.response;
          assistantMessage = Message.assistant(response.choice, response.messageId);
          newMessages[newMessages.length - 1] = assistantMessage;
          await this.memoryRecorder.commitMessages(
            runId,
            currentTurns,
            [assistantMessage],
            pendingTurnMessages,
          );
          if (!emittedTurnEnd && (bufferResponseEvents || bufferOutputDeltas)) {
            for (const event of responseStreamEvents(currentTurns, response)) {
              yield await emit(event);
            }
          }
          if (!emittedTurnEnd) {
            yield await emit({ type: "turn_end", turn: currentTurns, response });
          }

          const result: PromptResponse = {
            output: guardedOutput.output,
            usage,
            messages: [...newMessages],
            trace: runObservers.trace,
            guardrails: [...this.guardrailDecisions],
          };
          await this.runRunEndHook(result, newMessages);
          await runObservers.end(result);
          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          this.runState = "completed";
          yield await emit({
            type: "final",
            runId,
            output: result.output,
            usage: result.usage,
            messages: result.messages,
            trace: result.trace,
            guardrails: result.guardrails,
          });
          return;
        }

        if (bufferResponseEvents) {
          for (const event of responseStreamEvents(currentTurns, response)) {
            yield await emit(event);
          }
        } else {
          for (const toolCall of toolCalls) {
            if (!emittedToolCallIds.has(toolCall.id)) {
              yield await emit({ type: "tool_call", turn: currentTurns, toolCall });
            }
          }
        }
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage],
          pendingTurnMessages,
        );
        yield await emit({ type: "turn_end", turn: currentTurns, response });

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
      this.generationStartArgs(turn, request, providerRequest),
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

  private generationStartArgs(
    turn: number,
    request: ReturnType<CompletionRequestBuilder["build"]>,
    providerRequest: JsonObject | undefined,
  ): AgentGenerationStartArgs {
    const args: AgentGenerationStartArgs = {
      turn,
      request,
      modelInfo: {
        provider: this.agent.model.provider,
        defaultModel: this.agent.model.defaultModel,
        capabilities: this.agent.model.capabilities,
      },
    };
    if (providerRequest !== undefined) {
      args.providerRequest = providerRequest;
    }
    return args;
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

  private async runOutputGuardrailsForResponse(
    runId: string,
    usage: Usage,
    response: CompletionResponse,
    messages: MessageType[],
    runObservers: ActiveAgentRunObservers,
  ): Promise<{
    output: string;
    response: CompletionResponse;
    decisions: GuardrailDecisionRecord[];
  }> {
    const originalOutput = textFromAssistantContent(response.choice);
    const result = await runOutputGuardrails(this.guardrailPolicies, {
      outputText: originalOutput,
      messages: [...this.chatHistory, ...messages],
      usage,
      run: this.guardrailRunContext(runId),
    });
    for (const decision of result.decisions) {
      await this.recordGuardrailDecision(decision, runObservers);
    }
    const output = result.blocked
      ? (result.message ?? "The response was blocked by a guardrail.")
      : result.outputText;
    if (output === originalOutput) {
      return { output, response, decisions: result.decisions };
    }
    return {
      output,
      response: {
        ...response,
        choice: [AssistantContent.text(output)],
      },
      decisions: result.decisions,
    };
  }

  private async recordGuardrailDecision(
    decision: GuardrailDecisionRecord,
    runObservers: ActiveAgentRunObservers,
  ): Promise<void> {
    this.guardrailDecisions.push(decision);
    await runObservers.event({
      name: "guardrail.decision",
      level: decision.action === "block" ? "WARNING" : "DEFAULT",
      attributes: guardrailDecisionAttributes(decision),
    });
  }

  private guardrailRunContext(runId: string): GuardrailRunContext {
    const context: GuardrailRunContext = {
      agentId: this.agent.id,
      runId,
    };
    if (this.memoryContext !== undefined) {
      context.sessionId = this.memoryContext.sessionId;
      if (this.memoryContext.metadata !== undefined) {
        context.metadata = this.memoryContext.metadata;
      }
    }
    return context;
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
    const input: AgentEventAppendInput = {
      runId,
      agentId,
      event,
    };
    if (agentName !== undefined) {
      input.agentName = agentName;
    }
    if (turn !== undefined) {
      input.turn = turn;
    }
    if (event.type === "agent_tool_event") {
      input.toolName = event.toolName;
      input.internalCallId = event.internalCallId;
      if (event.toolCallId !== undefined) {
        input.toolCallId = event.toolCallId;
      }
    }
    await registration.store.append(input);
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

  private shouldBufferStreamResponseEvents(): boolean {
    return (
      this.activeHook?.onCompletionResponse !== undefined ||
      this.activeMiddlewares().some((middleware) => middleware.onCompletionResponse !== undefined)
    );
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
    if (this.runState === "idle") {
      this.runState = "running";
      return;
    }
    if (this.runState === "running") {
      throw new Error("PromptRequest is already running.");
    }
    throw new Error("PromptRequest has already been used.");
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

function responseStreamEvents(turn: number, response: CompletionResponse): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  for (const item of response.choice) {
    if (item.type === "text") {
      if (item.text.length > 0) {
        events.push({ type: "text_delta", turn, delta: item.text });
      }
      continue;
    }

    if (item.type === "reasoning") {
      if (item.content === undefined) {
        if (item.text.length > 0) {
          events.push(reasoningDeltaEvent(turn, item.text, { id: item.id }));
        }
        continue;
      }

      for (const content of item.content) {
        const delta =
          content.type === "encrypted" || content.type === "redacted" ? content.data : content.text;
        events.push(
          reasoningDeltaEvent(turn, delta, {
            id: item.id,
            contentType: content.type,
            signature: content.type === "text" ? content.signature : undefined,
          }),
        );
      }
      continue;
    }

    if (item.type === "tool_call") {
      events.push({ type: "tool_call", turn, toolCall: item });
    }
  }
  return events;
}

type ReasoningDeltaEvent = Extract<AgentStreamEvent, { type: "reasoning_delta" }>;

function reasoningDeltaEvent(
  turn: number,
  delta: string,
  details: {
    id?: ReasoningDeltaEvent["id"] | undefined;
    contentType?: ReasoningDeltaEvent["contentType"] | undefined;
    signature?: ReasoningDeltaEvent["signature"] | undefined;
  } = {},
): ReasoningDeltaEvent {
  const event: ReasoningDeltaEvent = {
    type: "reasoning_delta",
    turn,
    delta,
  };
  if (details.id !== undefined) {
    event.id = details.id;
  }
  if (details.contentType !== undefined) {
    event.contentType = details.contentType;
  }
  if (details.signature !== undefined) {
    event.signature = details.signature;
  }
  return event;
}

function textFromMessage(message: MessageType): string {
  if (message.role === "system") {
    return message.content;
  }
  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }
      if (content.type === "document" && content.source.type === "text") {
        return [content.source.text];
      }
      return [];
    })
    .join("\n");
}

function guardrailDecisionAttributes(
  decision: GuardrailDecisionRecord,
): Record<string, JsonValue | undefined> {
  const attributes: Record<string, JsonValue | undefined> = {
    policyId: decision.policyId,
    guardrailId: decision.guardrailId,
    boundary: decision.boundary,
    mode: decision.mode,
    action: decision.action,
    applied: decision.applied,
    latencyMs: decision.latencyMs,
  };
  if (decision.reason !== undefined) {
    attributes.reason = decision.reason;
  }
  if (decision.message !== undefined) {
    attributes.message = decision.message;
  }
  return attributes;
}
