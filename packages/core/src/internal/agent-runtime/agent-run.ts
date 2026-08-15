import { type Agent, getAgentProviderOutputSchema } from "../../agent/agent";
import { AgentRunCancelledError, MaxTurnsError } from "../../agent/errors";
import {
  type AgentFinishEvent,
  type AgentLifecycle,
  composeAgentLifecycle,
  lifecycleSnapshot,
} from "../../agent/lifecycle";
import type {
  AgentApprovalDecision,
  AgentApprovalRequiredEvent,
  AgentApprovalRequiredResult,
  AgentBlockedResult,
  AgentInput,
  AgentResponse,
  AgentRunOptions,
  AgentStreamEvent,
} from "../../agent/run-types";
import { getAgentToolState } from "../../agent/tool-state";
import { isStreamingCompletionModel } from "../../completion/generate-completion";
import {
  AssistantContent,
  assertCompletionRequestSupported,
  type CompletionModel,
  type CompletionResponse,
  type CompletionSource,
  getAssistantGenerationMetadata,
  type JsonObject,
  type JsonValue,
  Message,
  type Message as MessageType,
  type ProviderToolCall,
  type ToolCall,
  type ToolResult,
  textFromAssistantContent,
  Usage,
} from "../../completion/index";
import {
  appendGuardrailPolicies,
  type GuardrailDecisionRecord,
  type GuardrailPolicy,
  type GuardrailRunContext,
  hasEnforcedOutputGuardrails,
  runInputGuardrails,
  runOutputGuardrails,
} from "../../guardrails";
import type { AgentHook } from "../../hooks";
import { runControl } from "../../hooks";
import { MemoryCompactionError } from "../../memory/errors";
import type { MemoryContext } from "../../memory/types";
import type { ModelCallOptions } from "../../model-call-options";
import {
  type ActiveAgentRunObservers,
  type ActiveGenerationObservers,
  startAgentRunObservers,
} from "../../observability/group";
import type {
  AgentGenerationEndArgs,
  AgentGenerationModelInfo,
  AgentGenerationStartArgs,
  AgentTraceOptions,
} from "../../observability/types";
import {
  type ResolvedRetryOptions,
  resolveRetryOptions,
  retryDelayMs,
  retryErrorAttributes,
  retryOptionsForFailure,
  waitForRetry,
} from "../../retry";
import type { AgentMiddleware } from "../../tool/middleware";
import { abortError, throwIfAborted } from "../abort";
import { createAsyncQueue } from "../async-queue";
import { type CompletionRequestFor, createCompletionRequest } from "../completion-request";
import { extractRagText } from "../rag-text";
import { registerAgentApprovalRequestDetails } from "./approval-details";
import type { ToolApprovalRequest } from "./approval-request";
import { toolMayRequireApproval } from "./approval-requirement";
import { AgentRunMemory, type MemoryPreparation } from "./memory";
import { fetchContextDocuments, fetchToolDefinitions } from "./retrieval";
import { getInternalAgentRunOptions } from "./run-options";
import { assertNonnegativeSafeInteger, assertPositiveSafeInteger } from "./run-validation";
import { CompletionStreamAccumulator } from "./stream-accumulator";
import { addTurn, addTurnToToolCallDelta, isGenerationDeltaEvent } from "./stream-events";
import {
  type AgentToolEventPayload,
  ToolCallExecutor,
  type ToolExecutionEventPayload,
  type ToolExecutionObservation,
  type ToolResultEventPayload,
} from "./tool-execution";

type AgentRunCreateOptions<Output, RawResponse> = AgentRunOptions<Output, RawResponse> & {
  memoryContext?: MemoryContext | undefined;
};

type PendingApproval = {
  request: ToolApprovalRequest;
  resolve(decision: AgentApprovalDecision): void;
  reject(error: unknown): void;
};

type DeferredSignal = {
  promise: Promise<void>;
  resolve(): void;
};

type StreamingCompletionState = {
  response: CompletionResponse | undefined;
  firstDeltaMs: number | undefined;
  emittedToolCallIds: Set<string>;
  providerErrorUsage: Usage;
};

function deferredSignal(): DeferredSignal {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleFailureCleanup(
  operations: Array<() => void | Promise<void> | undefined>,
): Promise<void> {
  for (const operation of operations) {
    try {
      await operation();
    } catch {
      // Cleanup failures must not replace the primary run failure.
    }
  }
}

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse, infer _ModelName> ? RawResponse : unknown;

type AgentTerminalResult<Output> = AgentResponse<Output> | AgentBlockedResult;

export class AgentRun<Output = string, M extends CompletionModel = CompletionModel> {
  private chatHistory: MessageType[];
  private maxTurnCount: number;
  private activeHook: AgentHook | undefined;
  private readonly activeLifecycle: AgentLifecycle<Output, unknown> | undefined;
  private guardrailPolicies: GuardrailPolicy[];
  private guardrailDecisions: GuardrailDecisionRecord[] = [];
  private readonly concurrency: number;
  private traceOptions: AgentTraceOptions | undefined;
  private completionRetryOptions: ResolvedRetryOptions | undefined;
  private readonly requestMiddlewares: AgentMiddleware[];
  private readonly steeringMessages: MessageType[] = [];
  private runState: "idle" | "running" | "completed" | "errored" | "cancelled" = "idle";
  private readonly memoryRecorder: AgentRunMemory;
  private readonly memoryContext: MemoryContext | undefined;
  private pendingApproval: PendingApproval | undefined;
  private approvalSignal = deferredSignal();
  private activeRunId: string | undefined;
  private readonly requestedRunId: string | undefined;
  private currentUsage = Usage.empty();
  private currentMessages: MessageType[] = [];
  private cancellationError: AgentRunCancelledError | undefined;
  private activeGeneration: { turn: number; observers: ActiveGenerationObservers } | undefined;
  private readonly abortController = new AbortController();
  private removeExternalAbortListener: (() => void) | undefined;

  private constructor(
    private readonly agent: Agent<Output, M>,
    private promptMessage: MessageType,
    initialHistory: MessageType[] = [],
    options: AgentRunCreateOptions<Output, RawResponseOf<M>> = {},
  ) {
    this.chatHistory = initialHistory;
    this.maxTurnCount = assertNonnegativeSafeInteger(
      options.maxTurns ?? agent.defaultMaxTurns ?? 0,
      "maxTurns",
    );
    const internalOptions = getInternalAgentRunOptions(options);
    this.activeHook = internalOptions?.hook;
    this.requestedRunId = normalizeRequestedRunId(internalOptions?.runId);
    this.activeLifecycle = composeAgentLifecycle(agent.lifecycle, options.lifecycle) as
      | AgentLifecycle<Output, unknown>
      | undefined;
    this.guardrailPolicies =
      options.guardrails === undefined
        ? [...agent.guardrails]
        : appendGuardrailPolicies([...agent.guardrails], options.guardrails);
    const configuredConcurrency = assertPositiveSafeInteger(
      options.toolConcurrency ?? 1,
      "toolConcurrency",
    );
    this.concurrency =
      this.activeHook !== undefined ||
      agent.tools.some((tool) => toolMayRequireApproval(tool.requiresApproval))
        ? 1
        : configuredConcurrency;
    this.traceOptions = options.trace;
    const retrySetting = options.retries === undefined ? agent.retries : options.retries;
    this.completionRetryOptions =
      retrySetting === undefined || retrySetting === false
        ? undefined
        : resolveRetryOptions(retrySetting);
    this.requestMiddlewares = [...(options.middlewares ?? [])];
    this.memoryContext = options.memoryContext;
    this.memoryRecorder = new AgentRunMemory(agent, options.memoryContext, initialHistory);
    this.linkExternalAbortSignal(options.abortSignal);
  }

  static fromAgent<Output, M extends CompletionModel>(
    agent: Agent<Output, M>,
    input: AgentInput,
    options: AgentRunCreateOptions<Output, RawResponseOf<M>> = {},
  ): AgentRun<Output, M> {
    const normalized = normalizeAgentInput(input);
    return new AgentRun(agent, normalized.prompt, normalized.history, options);
  }

  steer(input: string | MessageType | MessageType[]): boolean {
    if (this.isTerminal() || this.cancellationError !== undefined) {
      return false;
    }

    this.steeringMessages.push(...normalizeSteeringInput(input));
    return true;
  }

  waitForApproval(): Promise<void> {
    return this.pendingApproval === undefined ? this.approvalSignal.promise : Promise.resolve();
  }

  approvalResult(): AgentApprovalRequiredResult {
    const snapshot = this.approvalSnapshot();
    return { status: "approval_required", ...snapshot };
  }

  approvalEvent(): AgentApprovalRequiredEvent {
    const snapshot = this.approvalSnapshot();
    return { type: "approval_required", ...snapshot };
  }

  resolveApproval(decision: AgentApprovalDecision): void {
    const pending = this.pendingApproval;
    if (pending === undefined) {
      throw new TypeError("Agent run has no pending tool approval.");
    }
    this.pendingApproval = undefined;
    this.approvalSignal = deferredSignal();
    pending.resolve(decision);
  }

  cancel(reason: string): void {
    if (this.isTerminal() || this.cancellationError !== undefined) {
      return;
    }
    const messages =
      this.currentMessages.length === 0 ? [this.promptMessage] : [...this.currentMessages];
    const error = new AgentRunCancelledError([...this.chatHistory, ...messages], reason);
    this.setCancellationError(error);
  }

  private setCancellationError(error: AgentRunCancelledError): void {
    this.cancellationError = error;
    if (!this.abortController.signal.aborted) this.abortController.abort(error);
    const pending = this.pendingApproval;
    if (pending !== undefined) {
      this.pendingApproval = undefined;
      this.approvalSignal = deferredSignal();
      pending.reject(error);
    }
  }

  async generate(): Promise<AgentTerminalResult<Output>> {
    this.startRun();
    const runId = this.requestedRunId ?? globalThis.crypto.randomUUID();
    this.activeRunId = runId;
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    let runObservers: ActiveAgentRunObservers | undefined;

    try {
      this.throwIfCancelled();
      const memoryPreparation = await this.memoryRecorder.prepareHistory(runId, newMessages.length);
      this.chatHistory = memoryPreparation.history;
      usage = Usage.add(usage, memoryPreparation.usage);
      runObservers = await this.startRunObservers(runId);
      await this.recordMemoryCompaction(memoryPreparation, runObservers);
      await this.activeLifecycle?.onStart?.({
        runId,
        input: lifecycleSnapshot(this.promptMessage),
        history: lifecycleSnapshot(this.chatHistory),
        maxTurns: this.maxTurnCount,
      });
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
        const text = inputResult.message ?? "The request was blocked by a guardrail.";
        const result: AgentBlockedResult = {
          status: "blocked",
          stage: "input",
          runId,
          text,
          usage,
          messages: [this.promptMessage, Message.assistant(text)],
          trace: runObservers.trace,
          guardrails: [...this.guardrailDecisions],
        };
        await this.runLifecycleFinish(result);
        await runObservers.end(result);
        this.runState = "completed";
        this.disposeAbortLink();
        return result;
      }

      newMessages = [this.promptMessage];
      await this.memoryRecorder.commitAcceptedInput(runId, newMessages);
      const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
      await this.runRunStartHook(newMessages);
      while (currentTurns <= this.maxTurnCount + 1) {
        const prompt = newMessages.at(-1);
        if (prompt === undefined) {
          throw new Error("AgentRun requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];
        await this.runTurnStartHook(currentTurns, prompt, historyForRequest, newMessages);
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const request = await this.createTurnRequest(prompt, historyForRequest, currentTurns);

        let response: CompletionResponse;
        try {
          response = await this.runCompletion(request, currentTurns, runObservers);
        } catch (error) {
          await settleFailureCleanup([
            () => this.runCompletionErrorHook(prompt, error, newMessages),
          ]);
          throw error;
        }
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        usage = Usage.add(usage, response.usage);
        this.updateApprovalProgress(runId, usage, newMessages);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);
        await this.activeLifecycle?.onStepFinish?.({
          runId,
          step: currentTurns,
          response: lifecycleSnapshot(response),
          usage: lifecycleSnapshot(usage),
        });

        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        const assistantMessage = this.generatedAssistantMessage(response, request);
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
          const finalAssistantMessage = this.generatedAssistantMessage(response, request);
          newMessages[newMessages.length - 1] = finalAssistantMessage;
          await this.memoryRecorder.commitMessages(
            runId,
            currentTurns,
            [finalAssistantMessage],
            pendingTurnMessages,
          );
          const result = this.createTerminalResult(
            runId,
            guardedOutput.text,
            guardedOutput.blocked,
            usage,
            newMessages,
            runObservers,
          );
          if (result.status === "completed") {
            await this.runRunEndHook(result, newMessages);
          }
          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          await this.runLifecycleFinish(result);
          await runObservers.end(result);
          this.runState = "completed";
          this.disposeAbortLink();
          return result;
        }

        this.updateApprovalProgress(runId, usage, newMessages);
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
          [assistantMessage, toolMessage],
          pendingTurnMessages,
        );
        await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages);
        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      if (error instanceof MemoryCompactionError && error.usage !== undefined) {
        usage = Usage.add(usage, error.usage);
      }
      const runError = this.normalizeRunError(error);
      const reportedError = await this.reportRunFailure(
        runError,
        runId,
        usage,
        newMessages,
        runObservers,
      );
      this.runState = reportedError instanceof AgentRunCancelledError ? "cancelled" : "errored";
      this.disposeAbortLink();
      throw reportedError;
    }
  }

  async *events(): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    this.startRun();
    const runId = this.requestedRunId ?? globalThis.crypto.randomUUID();
    this.activeRunId = runId;
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    const bufferOutputDeltas = hasEnforcedOutputGuardrails(this.guardrailPolicies);
    let runObservers: ActiveAgentRunObservers | undefined;

    try {
      this.throwIfCancelled();
      const memoryPreparation = await this.memoryRecorder.prepareHistory(runId, newMessages.length);
      this.chatHistory = memoryPreparation.history;
      usage = Usage.add(usage, memoryPreparation.usage);
      runObservers = await this.startRunObservers(runId);
      await this.recordMemoryCompaction(memoryPreparation, runObservers);
      await this.activeLifecycle?.onStart?.({
        runId,
        input: lifecycleSnapshot(this.promptMessage),
        history: lifecycleSnapshot(this.chatHistory),
        maxTurns: this.maxTurnCount,
      });
      const inputResult = await runInputGuardrails(this.guardrailPolicies, {
        prompt: this.promptMessage,
        history: this.chatHistory,
        inputText: textFromMessage(this.promptMessage),
        run: this.guardrailRunContext(runId),
      });
      for (const decision of inputResult.decisions) {
        await this.recordGuardrailDecision(decision, runObservers);
        yield { type: "guardrail_decision", decision };
      }
      this.promptMessage = inputResult.prompt;
      if (inputResult.blocked) {
        const text = inputResult.message ?? "The request was blocked by a guardrail.";
        const result: AgentBlockedResult = {
          status: "blocked",
          stage: "input",
          runId,
          text,
          usage,
          messages: [this.promptMessage, Message.assistant(text)],
          trace: runObservers.trace,
          guardrails: [...this.guardrailDecisions],
        };
        await this.runLifecycleFinish(result);
        await runObservers.end(result);
        this.runState = "completed";
        this.disposeAbortLink();
        yield { type: "final", result };
        return;
      }

      newMessages = [this.promptMessage];
      await this.memoryRecorder.commitAcceptedInput(runId, newMessages);
      const pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
      await this.runRunStartHook(newMessages);
      while (currentTurns <= this.maxTurnCount + 1) {
        const prompt = newMessages.at(-1);
        if (prompt === undefined) {
          throw new Error("AgentRun requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];
        yield {
          type: "turn_start",
          turn: currentTurns,
          prompt,
          history: historyForRequest,
        };
        await this.runTurnStartHook(currentTurns, prompt, historyForRequest, newMessages);
        await this.runCompletionCallHook(prompt, historyForRequest, newMessages);

        const request = await this.createTurnRequest(prompt, historyForRequest, currentTurns);

        assertCompletionRequestSupported(this.agent.model, request, { streaming: true });
        const providerRequest = this.providerTraceRequest(request, { stream: true });
        const generationStartArgs = this.generationStartArgs(
          currentTurns,
          request,
          providerRequest,
        );
        const generationObservers = await runObservers.startGeneration(generationStartArgs);
        this.activeGeneration = { turn: currentTurns, observers: generationObservers };
        const generationStartedAt = Date.now();
        yield {
          type: "generation_start",
          turn: currentTurns,
          request,
          modelInfo: generationStartArgs.modelInfo,
        };
        const bufferResponseEvents = this.shouldBufferStreamResponseEvents();
        const completionState: StreamingCompletionState = {
          response: undefined,
          firstDeltaMs: undefined,
          emittedToolCallIds: new Set(),
          providerErrorUsage: Usage.empty(),
        };
        let response: CompletionResponse;
        try {
          try {
            for await (const event of this.streamCompletion({
              request,
              turn: currentTurns,
              bufferResponseEvents,
              bufferOutputDeltas,
              generationStartedAt,
              generationObservers,
              runObservers,
              state: completionState,
            })) {
              yield event;
            }
          } finally {
            usage = Usage.add(usage, completionState.providerErrorUsage);
          }
          if (completionState.response === undefined) {
            throw new Error("Streaming completion ended without a response.");
          }
          response = completionState.response;
        } catch (error) {
          await settleFailureCleanup([
            () => this.closeActiveGeneration(error),
            () => this.runCompletionErrorHook(prompt, error, newMessages),
          ]);
          throw error;
        }
        const { firstDeltaMs, emittedToolCallIds } = completionState;

        const generationEndArgs: AgentGenerationEndArgs = {
          turn: currentTurns,
          response,
          ...(firstDeltaMs === undefined ? {} : { firstDeltaMs }),
        };
        this.activeGeneration = undefined;
        await generationObservers.end(generationEndArgs);
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        usage = Usage.add(usage, response.usage);
        this.updateApprovalProgress(runId, usage, newMessages);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);
        await this.activeLifecycle?.onStepFinish?.({
          runId,
          step: currentTurns,
          response: lifecycleSnapshot(response),
          usage: lifecycleSnapshot(usage),
        });

        const toolCalls = response.choice.filter(
          (item): item is ToolCall => item.type === "tool_call",
        );
        const assistantMessage = this.generatedAssistantMessage(response, request);
        newMessages.push(assistantMessage);

        if (toolCalls.length === 0) {
          let emittedTurnEnd = false;
          if (!bufferOutputDeltas) {
            if (bufferResponseEvents) {
              for (const event of responseStreamEvents(currentTurns, response)) {
                yield event as AgentStreamEvent<Output, RawResponseOf<M>>;
              }
            }
            yield {
              type: "turn_end",
              turn: currentTurns,
              response: response as CompletionResponse<RawResponseOf<M>>,
              firstDeltaMs,
            };
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

          for await (const event of this.completeStreamingRun({
            runId,
            turn: currentTurns,
            request,
            response,
            firstDeltaMs,
            usage,
            newMessages,
            pendingTurnMessages,
            runObservers,
            bufferResponseEvents,
            bufferOutputDeltas,
            emittedTurnEnd,
          })) {
            yield event;
          }
          return;
        }

        if (bufferResponseEvents) {
          for (const event of responseStreamEvents(currentTurns, response)) {
            yield event as AgentStreamEvent<Output, RawResponseOf<M>>;
          }
        } else {
          for (const toolCall of toolCalls) {
            if (!emittedToolCallIds.has(toolCall.id)) {
              yield { type: "tool_call", turn: currentTurns, toolCall };
            }
          }
        }
        this.updateApprovalProgress(runId, usage, newMessages);
        yield {
          type: "turn_end",
          turn: currentTurns,
          response: response as CompletionResponse<RawResponseOf<M>>,
          firstDeltaMs,
        };

        const toolExecution = this.executeStreamingToolCalls(runId, toolCalls, newMessages, {
          turn: currentTurns,
          runObservers,
          toolDefinitions: request.tools,
        });
        for await (const result of toolExecution.events) {
          yield { turn: currentTurns, ...result };
        }
        const toolResults = await toolExecution.results;
        const toolMessage = Message.tool(toolResults);
        newMessages.push(toolMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage, toolMessage],
          pendingTurnMessages,
        );
        await this.drainSteeringMessages(runId, currentTurns, newMessages, pendingTurnMessages);
        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      if (error instanceof MemoryCompactionError && error.usage !== undefined) {
        usage = Usage.add(usage, error.usage);
      }
      const runError = this.normalizeRunError(error);
      const reportedError = await this.reportRunFailure(
        runError,
        runId,
        usage,
        newMessages,
        runObservers,
      );
      this.runState = reportedError instanceof AgentRunCancelledError ? "cancelled" : "errored";
      const finalUsage = usage;
      yield { type: "error", error: reportedError, usage: finalUsage };
      this.disposeAbortLink();
      return;
    } finally {
      if (this.runState === "running") {
        const cancellation =
          this.cancellationError ??
          new AgentRunCancelledError([...this.chatHistory, ...newMessages], "Agent stream closed.");
        this.cancellationError = cancellation;
        await settleFailureCleanup([() => this.closeActiveGeneration(cancellation)]);
        await this.reportRunFailure(cancellation, runId, usage, newMessages, runObservers);
        this.runState = "cancelled";
        this.disposeAbortLink();
      }
    }
  }

  private async runCompletion(
    request: CompletionRequestFor<M>,
    turn: number,
    runObservers: ActiveAgentRunObservers,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this.agent.model, request);
    const providerRequest = this.providerTraceRequest(request);
    const generationObservers = await runObservers.startGeneration(
      this.generationStartArgs(turn, request, providerRequest),
    );
    try {
      for (let attempt = 1; ; attempt += 1) {
        let response: CompletionResponse;
        try {
          this.throwIfCancelled();
          response = await this.agent.model.completion(request, this.modelCallOptions());
        } catch (error) {
          const retryOptions = this.retryOptionsForFailure(error, attempt, turn, false);
          if (retryOptions === undefined) {
            throw error;
          }
          await this.scheduleCompletionRetry(
            error,
            attempt,
            turn,
            false,
            retryOptions,
            runObservers,
          );
          continue;
        }
        await generationObservers.end({ turn, response });
        return response;
      }
    } catch (error) {
      await settleFailureCleanup([() => generationObservers.error({ turn, error })]);
      throw error;
    }
  }

  private async createTurnRequest(
    prompt: MessageType,
    history: MessageType[],
    turn: number,
  ): Promise<CompletionRequestFor<M>> {
    const ragText = extractRagText(prompt);
    const abortSignal = this.abortController.signal;
    const documents = await fetchContextDocuments(this.agent, ragText, abortSignal);
    const toolDefinitions = await fetchToolDefinitions(this.agent, ragText, abortSignal);
    const request = createCompletionRequest([...history, prompt], {
      model: this.agent.model,
      instructions: this.agent.instructions,
      documents,
      tools: [...toolDefinitions, ...getAgentToolState(this.agent).providerTools],
      temperature: this.agent.temperature,
      maxTokens: this.agent.maxTokens,
      providerOptions: this.agent.providerOptions,
      toolChoice: this.agent.toolChoice,
      outputSchema: getAgentProviderOutputSchema(this.agent),
    });
    return (await this.runCompletionRequestMiddlewares(request, turn)) as CompletionRequestFor<M>;
  }

  private async *streamCompletion(args: {
    request: CompletionRequestFor<M>;
    turn: number;
    bufferResponseEvents: boolean;
    bufferOutputDeltas: boolean;
    generationStartedAt: number;
    generationObservers: ActiveGenerationObservers;
    runObservers: ActiveAgentRunObservers;
    state: StreamingCompletionState;
  }): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    const model = this.agent.model;
    if (!isStreamingCompletionModel(model)) {
      throw new TypeError("Streaming completion requires a streaming-capable model.");
    }
    const accumulator = new CompletionStreamAccumulator();
    for (let attempt = 1; ; attempt += 1) {
      let hasProviderProgress = false;
      try {
        this.throwIfCancelled();
        for await (const event of model.streamCompletion(args.request, this.modelCallOptions())) {
          if (event.type === "error") {
            if (event.usage !== undefined) {
              args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, event.usage);
            }
            throw event.error;
          }
          hasProviderProgress = true;
          if (args.state.firstDeltaMs === undefined && isGenerationDeltaEvent(event.type)) {
            args.state.firstDeltaMs = Date.now() - args.generationStartedAt;
          }
          const mapped = accumulator.accept(event);
          if (event.type === "tool_call_delta") {
            yield addTurnToToolCallDelta(args.turn, event);
          }
          if (mapped !== undefined) {
            await args.generationObservers.update?.({ turn: args.turn, delta: mapped });
            if (mapped.type === "tool_call") {
              args.state.emittedToolCallIds.add(mapped.toolCall.id);
            }
            const shouldBuffer =
              args.bufferResponseEvents ||
              (args.bufferOutputDeltas &&
                (mapped.type === "text_delta" || mapped.type === "reasoning_delta"));
            if (!shouldBuffer) {
              yield addTurn(args.turn, mapped) as AgentStreamEvent<Output, RawResponseOf<M>>;
            }
          }
        }
        args.state.response = accumulator.response();
        return;
      } catch (error) {
        const retryOptions = hasProviderProgress
          ? undefined
          : this.retryOptionsForFailure(error, attempt, args.turn, true);
        if (retryOptions === undefined) {
          throw error;
        }
        await this.scheduleCompletionRetry(
          error,
          attempt,
          args.turn,
          true,
          retryOptions,
          args.runObservers,
        );
      }
    }
  }

  private async *completeStreamingRun(args: {
    runId: string;
    turn: number;
    request: CompletionRequestFor<M>;
    response: CompletionResponse;
    firstDeltaMs: number | undefined;
    usage: Usage;
    newMessages: MessageType[];
    pendingTurnMessages: MessageType[];
    runObservers: ActiveAgentRunObservers;
    bufferResponseEvents: boolean;
    bufferOutputDeltas: boolean;
    emittedTurnEnd: boolean;
  }): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    const guardedOutput = await this.runOutputGuardrailsForResponse(
      args.runId,
      args.usage,
      args.response,
      args.newMessages,
      args.runObservers,
    );
    for (const decision of guardedOutput.decisions) {
      yield { type: "guardrail_decision", decision };
    }

    const response = guardedOutput.response;
    const assistantMessage = this.generatedAssistantMessage(response, args.request);
    args.newMessages[args.newMessages.length - 1] = assistantMessage;
    await this.memoryRecorder.commitMessages(
      args.runId,
      args.turn,
      [assistantMessage],
      args.pendingTurnMessages,
    );
    if (!args.emittedTurnEnd && (args.bufferResponseEvents || args.bufferOutputDeltas)) {
      for (const event of responseStreamEvents(args.turn, response, args.bufferResponseEvents)) {
        yield event as AgentStreamEvent<Output, RawResponseOf<M>>;
      }
    }
    if (!args.emittedTurnEnd) {
      yield {
        type: "turn_end",
        turn: args.turn,
        response: response as CompletionResponse<RawResponseOf<M>>,
        firstDeltaMs: args.firstDeltaMs,
      };
    }

    const result = this.createTerminalResult(
      args.runId,
      guardedOutput.text,
      guardedOutput.blocked,
      args.usage,
      args.newMessages,
      args.runObservers,
    );
    if (result.status === "completed") {
      await this.runRunEndHook(result, args.newMessages);
    }
    await this.memoryRecorder.commitCompletedRun(
      args.runId,
      args.turn,
      args.newMessages,
      args.pendingTurnMessages,
    );
    await this.runLifecycleFinish(result);
    await args.runObservers.end(result);
    this.runState = "completed";
    this.disposeAbortLink();
    yield { type: "final", result };
  }

  private generatedAssistantMessage(
    response: CompletionResponse,
    request: CompletionRequestFor<M>,
  ): MessageType {
    const metadata: JsonObject = {
      anvia: {
        generation: {
          provider: this.agent.model.provider,
          model: request.model ?? this.agent.model.defaultModel,
          usage: { ...response.usage },
          ...(response.contextUsage === undefined ? {} : { contextUsage: response.contextUsage }),
          ...(response.sources === undefined ? {} : { sources: response.sources }),
          ...(response.providerToolCalls === undefined
            ? {}
            : { providerToolCalls: response.providerToolCalls }),
        },
      },
    };
    return Message.assistant(response.choice, {
      ...(response.messageId === undefined ? {} : { id: response.messageId }),
      metadata,
    });
  }

  private providerTraceRequest(
    request: CompletionRequestFor<M>,
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
    request: CompletionRequestFor<M>,
    providerRequest: JsonObject | undefined,
  ): AgentGenerationStartArgs & { modelInfo: AgentGenerationModelInfo } {
    return {
      turn,
      request,
      modelInfo: {
        provider: this.agent.model.provider,
        defaultModel: this.agent.model.defaultModel,
        capabilities: this.agent.model.capabilities,
      },
      ...(providerRequest === undefined ? {} : { providerRequest }),
    };
  }

  private retryOptionsForFailure(
    error: unknown,
    attempt: number,
    turn: number,
    streaming: boolean,
  ): ResolvedRetryOptions | undefined {
    if (this.abortController.signal.aborted) return undefined;
    return retryOptionsForFailure(this.completionRetryOptions, {
      error,
      attempt,
      turn,
      streaming,
    });
  }

  private async scheduleCompletionRetry(
    error: unknown,
    attempt: number,
    turn: number,
    streaming: boolean,
    options: ResolvedRetryOptions,
    runObservers: ActiveAgentRunObservers,
  ): Promise<void> {
    const delayMs = retryDelayMs(options, attempt);
    await runObservers.event({
      name: "completion.retry",
      level: "WARNING",
      attributes: {
        turn,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: options.maxAttempts,
        delayMs,
        streaming,
        ...retryErrorAttributes(error),
      },
    });
    await waitForRetry(delayMs, this.abortController.signal);
  }

  private async executeToolCalls(
    runId: string,
    toolCalls: ToolCall[],
    newMessages: MessageType[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResult[]> {
    const executor = new ToolCallExecutor(
      this.agent,
      this.activeHook,
      (request) => this.suspendForApproval(request),
      this.activeLifecycle,
      {
        runId,
        sessionId: this.memoryContext?.sessionId,
        metadata: this.memoryContext?.metadata,
      },
      this.concurrency,
      this.requestMiddlewares,
      this.abortController.signal,
      (reason) => this.cancelled(newMessages, reason),
    );
    return executor.execute(toolCalls, onResult, onStreamEvent, observation);
  }

  private executeStreamingToolCalls(
    runId: string,
    toolCalls: ToolCall[],
    newMessages: MessageType[],
    observation: ToolExecutionObservation,
  ): {
    events: AsyncIterable<ToolExecutionEventPayload>;
    results: Promise<ToolResult[]>;
  } {
    const events = createAsyncQueue<ToolExecutionEventPayload>();
    const results = this.executeToolCalls(
      runId,
      toolCalls,
      newMessages,
      (result) => events.enqueue(result),
      (event) => events.enqueue(event),
      observation,
    );
    results.then(
      () => events.close(),
      (error: unknown) => events.throw(error),
    );
    return { events, results };
  }

  private suspendForApproval(request: ToolApprovalRequest): Promise<AgentApprovalDecision> {
    if (this.cancellationError !== undefined) {
      return Promise.reject(this.cancellationError);
    }
    if (this.pendingApproval !== undefined) {
      throw new Error("Agent run already has a pending tool approval.");
    }
    return new Promise<AgentApprovalDecision>((resolve, reject) => {
      this.pendingApproval = { request, resolve, reject };
      this.approvalSignal.resolve();
    });
  }

  private async closeActiveGeneration(error: unknown): Promise<void> {
    const active = this.activeGeneration;
    if (active === undefined) {
      return;
    }
    this.activeGeneration = undefined;
    await active.observers.error({ turn: active.turn, error });
  }

  private approvalSnapshot(): Omit<AgentApprovalRequiredResult, "status"> {
    const pending = this.pendingApproval;
    const runId = this.activeRunId;
    if (pending === undefined || runId === undefined) {
      throw new TypeError("Agent run has no pending tool approval.");
    }
    const approval = {
      id: pending.request.id,
      toolName: pending.request.toolName,
      input: lifecycleSnapshot(pending.request.args),
      ...(pending.request.toolCallId === undefined
        ? {}
        : { toolCallId: pending.request.toolCallId }),
      ...(pending.request.reason === undefined ? {} : { reason: pending.request.reason }),
    };
    registerAgentApprovalRequestDetails(approval, pending.request);
    return {
      runId,
      approval,
      usage: lifecycleSnapshot(this.currentUsage),
      messages: lifecycleSnapshot(this.currentMessages),
    };
  }

  private updateApprovalProgress(runId: string, usage: Usage, messages: MessageType[]): void {
    this.activeRunId = runId;
    this.currentUsage = usage;
    this.currentMessages = [...messages];
  }

  private async runLifecycleFinish(result: AgentTerminalResult<Output>): Promise<void> {
    const common = {
      runId: result.runId,
      text: result.text,
      usage: lifecycleSnapshot(result.usage),
      messages: lifecycleSnapshot(result.messages),
    };
    const event =
      result.status === "completed"
        ? {
            ...common,
            status: "completed",
            output: lifecycleSnapshot(result.output),
          }
        : {
            ...common,
            status: "blocked",
            stage: result.stage,
          };
    await this.activeLifecycle?.onFinish?.(event as AgentFinishEvent<Output>);
  }

  private async runLifecycleError(
    error: unknown,
    runId: string,
    usage: Usage,
    messages: MessageType[],
  ): Promise<unknown | undefined> {
    try {
      await this.activeLifecycle?.onError?.({
        runId,
        error: lifecycleSnapshot(error),
        usage: lifecycleSnapshot(usage),
        messages: lifecycleSnapshot([...this.chatHistory, ...messages]),
      });
      return undefined;
    } catch (lifecycleError) {
      return lifecycleError;
    }
  }

  private async reportRunFailure(
    error: unknown,
    runId: string,
    usage: Usage,
    messages: MessageType[],
    runObservers: ActiveAgentRunObservers | undefined,
  ): Promise<unknown> {
    const reportedError = await this.resolveReportedRunError(error, runId, usage, messages);
    await settleFailureCleanup([
      () =>
        runObservers?.error({
          error: reportedError,
          usage,
          messages: [...messages],
        }),
      () => this.memoryRecorder.recordError(runId, reportedError, messages),
    ]);
    return reportedError;
  }

  private async resolveReportedRunError(
    error: unknown,
    runId: string,
    usage: Usage,
    messages: MessageType[],
  ): Promise<unknown> {
    try {
      await this.runRunErrorHook(error, usage, messages);
    } catch {
      // Error hooks are diagnostic cleanup and must not replace the run failure.
    }
    await this.runLifecycleError(error, runId, usage, messages);
    return error;
  }

  private async runOutputGuardrailsForResponse(
    runId: string,
    usage: Usage,
    response: CompletionResponse,
    messages: MessageType[],
    runObservers: ActiveAgentRunObservers,
  ): Promise<{
    text: string;
    blocked: boolean;
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
    const text = result.blocked
      ? (result.message ?? "The response was blocked by a guardrail.")
      : result.outputText;
    if (text === originalOutput) {
      return { text, blocked: result.blocked, response, decisions: result.decisions };
    }
    return {
      text,
      blocked: result.blocked,
      response: {
        ...response,
        choice: [AssistantContent.text(text)],
      },
      decisions: result.decisions,
    };
  }

  private createTerminalResult(
    runId: string,
    text: string,
    blocked: boolean,
    usage: Usage,
    messages: MessageType[],
    runObservers: ActiveAgentRunObservers,
  ): AgentTerminalResult<Output> {
    const common = {
      runId,
      text,
      usage,
      messages: [...messages],
      trace: runObservers.trace,
      guardrails: [...this.guardrailDecisions],
      ...generationArtifacts(messages),
    };
    if (blocked) {
      return { ...common, status: "blocked", stage: "output" };
    }
    return {
      ...common,
      status: "completed",
      output: this.parseOutput(text),
    };
  }

  private parseOutput(text: string): Output {
    const schema = this.agent.outputSchema;
    if (schema === undefined) return text as Output;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error("Agent expected the model response to be valid JSON.", { cause: error });
    }
    return schema.parse(json);
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

  private async recordMemoryCompaction(
    preparation: MemoryPreparation,
    runObservers: ActiveAgentRunObservers,
  ): Promise<void> {
    const compaction = preparation.compaction;
    if (compaction === undefined) {
      return;
    }
    await runObservers.event({
      name: "memory.compaction",
      attributes: {
        originalMessageCount: compaction.originalMessageCount,
        compactedMessageCount: compaction.compactedMessageCount,
        retainedMessageCount: compaction.retainedMessageCount,
        conflictRetries: compaction.conflictRetries,
        inputTokens: preparation.usage.inputTokens,
        outputTokens: preparation.usage.outputTokens,
        totalTokens: preparation.usage.totalTokens,
      },
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

  private async startRunObservers(runId: string): Promise<ActiveAgentRunObservers> {
    const failOnObserverError =
      this.traceOptions?.failOnObserverError === true ||
      this.agent.observers.some((registration) => registration.failOnObserverError === true);
    return startAgentRunObservers(
      this.agent.observers,
      {
        runId,
        agentName: this.agent.name,
        agentDescription: this.agent.description,
        instructions: this.agent.instructions,
        trace: this.traceOptions,
        promptRef: this.traceOptions?.promptRef,
        prompt: this.promptMessage,
        history: this.chatHistory,
        maxTurns: this.maxTurnCount,
      },
      failOnObserverError,
    );
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

  private async runRunEndHook(
    result: AgentResponse<Output>,
    newMessages: MessageType[],
  ): Promise<void> {
    const action = await this.activeHook?.onRunEnd?.({
      status: "completed",
      output: result.output,
      text: result.text,
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
  ): Promise<void> {
    const action = await this.activeHook?.onRunError?.({
      error,
      usage,
      messages: [...this.chatHistory, ...newMessages],
      run: runControl,
    });
    if (action?.type === "terminate") {
      this.cancelled(newMessages, action.reason);
    }
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
    request: CompletionRequestFor<M>,
    turn: number,
  ): Promise<CompletionRequestFor<M>> {
    let current = request;
    for (const middleware of this.activeMiddlewares()) {
      const replacement = await middleware.onCompletionRequest?.({
        turn,
        request: current,
        originalRequest: request,
      });
      if (replacement?.request !== undefined) {
        current = replacement.request as CompletionRequestFor<M>;
      }
    }
    return current;
  }

  private async runCompletionResponseMiddlewares(
    request: CompletionRequestFor<M>,
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
      throw new Error("Agent stream is already running.");
    }
    throw new Error("Agent stream has already been consumed.");
  }

  private isTerminal(): boolean {
    return (
      this.runState === "completed" || this.runState === "errored" || this.runState === "cancelled"
    );
  }

  private cancelled(newMessages: MessageType[], reason: string): AgentRunCancelledError {
    if (this.cancellationError !== undefined) return this.cancellationError;
    const error = new AgentRunCancelledError([...this.chatHistory, ...newMessages], reason);
    this.setCancellationError(error);
    return error;
  }

  private linkExternalAbortSignal(signal: AbortSignal | undefined): void {
    if (signal === undefined) return;
    const cancelFromSignal = () => {
      if (this.cancellationError !== undefined || this.isTerminal()) return;
      const cause = abortError(signal.reason);
      const reason = abortReason(signal.reason);
      const messages =
        this.currentMessages.length === 0 ? [this.promptMessage] : [...this.currentMessages];
      this.setCancellationError(
        new AgentRunCancelledError([...this.chatHistory, ...messages], reason, { cause }),
      );
    };
    if (signal.aborted) {
      cancelFromSignal();
      return;
    }
    signal.addEventListener("abort", cancelFromSignal, { once: true });
    this.removeExternalAbortListener = () => signal.removeEventListener("abort", cancelFromSignal);
  }

  private throwIfCancelled(): void {
    if (this.cancellationError !== undefined) throw this.cancellationError;
    throwIfAborted(this.abortController.signal);
  }

  private normalizeRunError(error: unknown): unknown {
    return this.abortController.signal.aborted && this.cancellationError !== undefined
      ? this.cancellationError
      : error;
  }

  private modelCallOptions(): ModelCallOptions {
    return { abortSignal: this.abortController.signal };
  }

  private disposeAbortLink(): void {
    this.removeExternalAbortListener?.();
    this.removeExternalAbortListener = undefined;
  }
}

function abortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) return reason;
  if (reason instanceof Error && reason.message.trim().length > 0) return reason.message;
  return "External abort signal.";
}

function normalizeAgentInput(prompt: AgentInput): {
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
    throw new TypeError("Agent input transcript must contain at least one message.");
  }
  const activePrompt = prompt.at(-1);
  if (activePrompt === undefined) {
    throw new TypeError("Agent input transcript must contain at least one message.");
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

function normalizeRequestedRunId(runId: string | undefined): string | undefined {
  if (runId === undefined) {
    return undefined;
  }
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new TypeError("runId must be a non-empty string.");
  }
  return runId;
}

function responseStreamEvents(
  turn: number,
  response: CompletionResponse,
  includeProviderArtifacts = true,
): AgentStreamEvent[] {
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
  if (includeProviderArtifacts) {
    for (const source of response.sources ?? []) {
      events.push({ type: "source", turn, source });
    }
    for (const toolCall of response.providerToolCalls ?? []) {
      events.push({ type: "provider_tool_call", turn, toolCall });
    }
  }
  return events;
}

function generationArtifacts(messages: MessageType[]): {
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
  contextUsage?: import("../../completion/index").ContextUsage;
} {
  const sources = new Map<string, CompletionSource>();
  const providerToolCalls = new Map<string, ProviderToolCall>();
  let contextUsage: import("../../completion/index").ContextUsage | undefined;
  for (const message of messages) {
    const metadata = getAssistantGenerationMetadata(message);
    if (metadata !== undefined) {
      contextUsage = metadata.contextUsage;
    }
    for (const source of metadata?.sources ?? []) {
      const key = `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
      sources.set(key, source);
    }
    for (const toolCall of metadata?.providerToolCalls ?? []) {
      providerToolCalls.set(toolCall.id, toolCall);
    }
  }
  return {
    ...(sources.size === 0 ? {} : { sources: [...sources.values()] }),
    ...(providerToolCalls.size === 0 ? {} : { providerToolCalls: [...providerToolCalls.values()] }),
    ...(contextUsage === undefined ? {} : { contextUsage }),
  };
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
