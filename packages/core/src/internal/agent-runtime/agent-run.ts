import type { Agent } from "../../agent/agent";
import {
  AgentRunCancelledError,
  AgentStreamClosedError,
  AgentStructuredOutputError,
  MaxTurnsError,
} from "../../agent/errors";
import {
  type AgentInteractionResponse,
  assertAgentInteractionResponse,
  parseAgentContinuation,
  parseAgentInteractionResponse,
} from "../../agent/interactions";
import {
  type AgentFinishEvent,
  type AgentLifecycle,
  composeAgentLifecycle,
  lifecycleSnapshot,
} from "../../agent/lifecycle";
import { getAgentProviderOutputSchema } from "../../agent/output-schema";
import type {
  AgentBlockedOutcome,
  AgentInput,
  AgentInteractionOutcome,
  AgentOutcome,
  AgentResponse,
  AgentRunOptions,
  AgentRunSettings,
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStreamEvent,
} from "../../agent/run-types";
import { getAgentToolState } from "../../agent/tool-state";
import { isStreamingCompletionModel } from "../../completion/generate-completion";
import {
  assertCompletionRequestSupported,
  type CompletionModelControls,
  type CompletionModelControlsOf,
  type CompletionFinishReason,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionSource,
  getAssistantGenerationMetadata,
  isJsonValue,
  type JsonObject,
  type Message as MessageType,
  mergeCompletionControlValues,
  type ProviderToolCall,
  parseMessage,
  parseMessages,
  type ToolCallPart,
  type ToolInteractionResponsePart,
  type ToolResultPart,
  textFromAssistantContent,
  Usage,
} from "../../completion/index";
import { assertCompletionResponseIntegrity } from "../../completion/provider-output-error";
import { CompletionStreamAccumulator } from "../../completion/stream-accumulator";
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
import type { MemoryCompactionInfo, MemoryScope } from "../../memory/types";
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
  AgentRunEndArgs,
  AgentTraceOptions,
} from "../../observability/types";
import {
  completionProviderOutputErrorUsage,
  type ResolvedRetryOptions,
  resolveRetryOptions,
  retryDelayMs,
  retryErrorAttributes,
  retryOptionsForFailure,
  waitForRetry,
} from "../../retry";
import type { AgentMiddleware } from "../../tool/middleware";
import { isQuestionTool } from "../../tool/question-tool";
import { abortError, throwIfAborted } from "../abort";
import { createAsyncQueue } from "../async-queue";
import { createCompletionRequest } from "../completion-request";
import { assertJsonObject } from "../json-object";
import { extractRagText } from "../rag-text";
import { toolMayRequireApproval } from "./approval-requirement";
import {
  type AgentContinuationState,
  parseContinuationState,
  type QueuedSteering,
  questionResult,
  serializeContinuationState,
} from "./continuation-state";
import {
  AgentInteractionSignal,
  approvalInteraction,
  ToolExecutionSuspension,
} from "./interaction-suspension";
import { AgentRunMemory, type MemoryPreparation } from "./memory";
import { normalizeMemoryScope } from "./memory-scope";
import { fetchContextDocuments, fetchToolDefinitions } from "./retrieval";
import { getInternalAgentRunOptions, type InternalAgentRunOptions } from "./run-options";
import { assertNonnegativeSafeInteger, assertPositiveSafeInteger } from "./run-validation";
import { addTurn, addTurnToToolCallDelta, isGenerationDeltaEvent } from "./stream-events";
import {
  normalizeStructuredOutput,
  STRUCTURED_OUTPUT_RETRY_PROMPT,
  STRUCTURED_OUTPUT_TRUNCATED_RETRY_PROMPT,
  structuredOutputRepairPreview,
} from "./structured-output";
import {
  type AgentToolEventPayload,
  ToolCallExecutor,
  type ToolExecutionEventPayload,
  type ToolExecutionObservation,
  type ToolResultEventPayload,
} from "./tool-execution";

type AgentRunCreateOptions<
  Output,
  RawResponse,
  Controls extends CompletionModelControls,
> = AgentRunSettings<Output, RawResponse, Controls> & {
  memoryScope?: MemoryScope | undefined;
  continuationState?: AgentContinuationState | undefined;
  interactionResponse?: AgentInteractionResponse | undefined;
  sourceRunId?: string | undefined;
  interactionId?: string | undefined;
};

type StreamingCompletionState = {
  response: CompletionResponse | undefined;
  firstDeltaMs: number | undefined;
  emittedToolCallIds: Set<string>;
  providerErrorUsage: Usage;
};

type StructuredOutputRetryRequest = Readonly<{
  request: CompletionRequest;
  previousResponse: "omitted" | "preview";
  includedOutputLength: number;
}>;

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
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

type AgentTerminalResult<Output> = AgentOutcome<Output>;

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
  private readonly controls: Readonly<Record<string, string>> | undefined;
  private readonly steeringMessages: QueuedSteering[] = [];
  private runState: "idle" | "running" | "closing" | "completed" | "errored" | "cancelled" = "idle";
  private readonly memoryRecorder: AgentRunMemory;
  private readonly memoryScope: MemoryScope | undefined;
  private readonly onInternalFailure: InternalAgentRunOptions["onFailure"];
  private readonly onInternalMemoryCompaction: InternalAgentRunOptions["onMemoryCompaction"];
  private memoryCompaction: MemoryCompactionInfo | undefined;
  private readonly requestedRunId: string | undefined;
  private readonly continuationState: AgentContinuationState | undefined;
  private readonly interactionResponse: AgentInteractionResponse | undefined;
  private readonly resumedFrom: { runId: string; interactionId: string } | undefined;
  private currentMessages: MessageType[] = [];
  private cancellationError: AgentRunCancelledError | undefined;
  private activeGeneration: { turn: number; observers: ActiveGenerationObservers } | undefined;
  private validatedStructuredOutput: { text: string; output: Output } | undefined;
  private failedCompletionUsage = Usage.empty();
  private readonly abortController = new AbortController();
  private removeExternalAbortListener: (() => void) | undefined;

  private constructor(
    private readonly agent: Agent<Output, M>,
    private promptMessage: MessageType,
    initialHistory: MessageType[] = [],
    options: AgentRunCreateOptions<Output, RawResponseOf<M>, CompletionModelControlsOf<M>> = {},
  ) {
    this.chatHistory = initialHistory;
    this.maxTurnCount = assertNonnegativeSafeInteger(
      options.maxTurns ?? agent.defaultMaxTurns ?? 0,
      "maxTurns",
    );
    const internalOptions = getInternalAgentRunOptions(options);
    this.activeHook = internalOptions?.hook;
    this.onInternalFailure = internalOptions?.onFailure;
    this.onInternalMemoryCompaction = internalOptions?.onMemoryCompaction;
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
      agent.tools.some(
        (tool) => toolMayRequireApproval(tool.requiresApproval) || isQuestionTool(tool),
      )
        ? 1
        : configuredConcurrency;
    this.traceOptions = options.trace;
    const retrySetting = options.retries === undefined ? agent.retries : options.retries;
    this.completionRetryOptions =
      retrySetting === undefined || retrySetting === false
        ? undefined
        : resolveRetryOptions(retrySetting);
    this.requestMiddlewares = [...(options.middlewares ?? [])];
    this.controls = mergeCompletionControlValues(agent.controls, options.controls);
    this.memoryScope = options.memoryScope;
    this.memoryRecorder = new AgentRunMemory(agent, options.memoryScope, initialHistory);
    this.continuationState = options.continuationState;
    this.interactionResponse = options.interactionResponse;
    if (options.continuationState !== undefined) {
      this.steeringMessages.push(
        ...options.continuationState.steering.map((entry) => ({
          id: entry.id,
          messages: [...entry.messages],
        })),
      );
    }
    this.resumedFrom =
      options.sourceRunId === undefined || options.interactionId === undefined
        ? undefined
        : { runId: options.sourceRunId, interactionId: options.interactionId };
    this.linkExternalAbortSignal(options.abortSignal);
  }

  static fromAgent<Output, M extends CompletionModel>(
    agent: Agent<Output, M>,
    options: AgentRunOptions<Output, RawResponseOf<M>, CompletionModelControlsOf<M>>,
  ): AgentRun<Output, M> {
    const normalized = normalizeAgentInput(agent.id, options);
    if (normalized.scope !== undefined && agent.memory === undefined) {
      throw new TypeError(`Agent "${agent.id}" cannot use a session without a memory store.`);
    }
    return new AgentRun(agent, normalized.prompt, normalized.history, {
      ...options,
      memoryScope: normalized.scope,
      continuationState: normalized.continuationState,
      interactionResponse: normalized.interactionResponse,
      sourceRunId: normalized.sourceRunId,
      interactionId: normalized.interactionId,
    });
  }

  steer(input: AgentSteerInput): AgentSteerReceipt {
    if (this.isTerminal() || this.cancellationError !== undefined) {
      throw new AgentStreamClosedError();
    }
    const receipt: AgentSteerReceipt = Object.freeze({
      id: globalThis.crypto.randomUUID(),
      status: "queued",
    });
    this.steeringMessages.push({ id: receipt.id, messages: normalizeSteeringInput(input) });
    return receipt;
  }

  cancel(reason: string): AgentRunCancelledError | undefined {
    if (this.isTerminal() || this.cancellationError !== undefined) {
      return this.cancellationError;
    }
    const messages =
      this.currentMessages.length === 0 ? [this.promptMessage] : [...this.currentMessages];
    const error = new AgentRunCancelledError([...this.chatHistory, ...messages], reason);
    this.setCancellationError(error);
    return error;
  }

  private setCancellationError(error: AgentRunCancelledError): void {
    this.cancellationError = error;
    if (!this.abortController.signal.aborted) this.abortController.abort(error);
  }

  async generate(): Promise<AgentTerminalResult<Output>> {
    this.startRun();
    const runId = this.requestedRunId ?? globalThis.crypto.randomUUID();
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    let runObservers: ActiveAgentRunObservers | undefined;
    let pendingTurnMessages: MessageType[] = [];

    try {
      this.throwIfCancelled();
      const memoryPreparation =
        this.continuationState === undefined
          ? await this.memoryRecorder.prepareHistory(
              runId,
              newMessages,
              this.abortController.signal,
            )
          : undefined;
      if (memoryPreparation !== undefined) {
        this.chatHistory = memoryPreparation.history;
        usage = Usage.add(usage, memoryPreparation.usage);
        this.memoryCompaction = memoryPreparation.compaction;
        await this.notifyInternalMemoryCompaction(memoryPreparation.compaction);
      }
      runObservers = await this.startRunObservers(runId);
      if (memoryPreparation !== undefined) {
        await this.recordMemoryCompaction(memoryPreparation, runObservers);
      }
      this.throwIfCancelled();
      await this.activeLifecycle?.onStart?.({
        runId,
        input: lifecycleSnapshot(this.promptMessage),
        history: lifecycleSnapshot(this.chatHistory),
        maxTurns: this.maxTurnCount,
      });
      if (this.continuationState === undefined) {
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
          const result: AgentBlockedOutcome = {
            type: "blocked",
            stage: "input",
            ...blockedOutcomeDetails(
              this.guardrailDecisions,
              "The request was blocked by a guardrail.",
            ),
            runId,
            text,
            usage,
            messages: [this.promptMessage, { role: "assistant", content: text }],
            trace: runObservers.trace,
            guardrails: [...this.guardrailDecisions],
            ...this.memoryCompactionResult(),
          };
          if (this.resumedFrom !== undefined) result.resumedFrom = this.resumedFrom;
          this.runState = "closing";
          await this.runLifecycleFinish(result);
          await runObservers.end(observerRunEnd(result));
          this.runState = "completed";
          this.disposeAbortLink();
          return result;
        }
      }

      newMessages = [this.promptMessage];
      await this.memoryRecorder.commitAcceptedInput(runId, newMessages);
      pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
      await this.runRunStartHook(newMessages);
      if (this.continuationState !== undefined) {
        const interactionAttributes: JsonObject = {};
        if (this.resumedFrom?.runId !== undefined) {
          interactionAttributes.sourceRunId = this.resumedFrom.runId;
        }
        if (this.resumedFrom?.interactionId !== undefined) {
          interactionAttributes.interactionId = this.resumedFrom.interactionId;
        }
        if (this.interactionResponse?.type !== undefined) {
          interactionAttributes.interactionType = this.interactionResponse.type;
        }
        await runObservers.event({
          name: "agent.interaction_response",
          attributes: interactionAttributes,
        });
        try {
          const toolResults = await this.resolveContinuationTools(
            runId,
            newMessages,
            undefined,
            undefined,
            {
              turn: 1,
              runObservers,
            },
          );
          const toolMessage: MessageType = { role: "tool", content: toolResults };
          newMessages.push(toolMessage);
          await this.memoryRecorder.commitMessages(runId, 1, [toolMessage], pendingTurnMessages);
          await this.drainSteeringMessages(runId, 1, newMessages, pendingTurnMessages);
          await this.memoryRecorder.commitCompletedTurn(runId, 1, pendingTurnMessages);
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            return this.finishSuspension({
              runId,
              turn: 1,
              usage,
              newMessages,
              pendingTurnMessages,
              runObservers,
              suspension: error,
              uncommittedMessages: [],
            });
          }
          throw error;
        }
      }
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
        try {
          assertCompletionResponseIntegrity({ response });
        } catch (error) {
          const providerOutputUsage = completionProviderOutputErrorUsage(error);
          if (providerOutputUsage !== undefined) usage = Usage.add(usage, providerOutputUsage);
          throw error;
        }
        usage = Usage.add(usage, response.usage);
        this.updateRunProgress(newMessages);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);
        await this.activeLifecycle?.onStepFinish?.({
          runId,
          step: currentTurns,
          response: lifecycleSnapshot(response),
          usage: lifecycleSnapshot(usage),
        });

        const toolCalls = response.choice.filter(
          (item): item is ToolCallPart => item.type === "tool-call",
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
          const appliedSteering = await this.drainSteeringMessages(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
            { closeWhenEmpty: true },
          );
          if (appliedSteering.length > 0) {
            for (const receipt of appliedSteering) {
              await runObservers.event({
                name: "agent.steering_applied",
                attributes: { id: receipt.id, turn: currentTurns },
              });
            }
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
          if (result.type === "response") {
            await this.runRunEndHook(result, newMessages);
          }
          await this.memoryRecorder.commitCompletedRun(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
          );
          await this.runLifecycleFinish(result);
          await runObservers.end(observerRunEnd(result));
          this.runState = "completed";
          this.disposeAbortLink();
          return result;
        }

        this.updateRunProgress(newMessages);
        let toolResults: ToolResultPart[];
        try {
          toolResults = await this.executeToolCalls(
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
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            return this.finishSuspension({
              runId,
              turn: currentTurns,
              usage,
              newMessages,
              pendingTurnMessages,
              runObservers,
              suspension: error,
              uncommittedMessages: [assistantMessage],
            });
          }
          throw error;
        }
        const toolMessage: MessageType = { role: "tool", content: toolResults };
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
      const failedCompletionUsage = this.takeFailedCompletionUsage();
      if (error instanceof AgentStructuredOutputError) {
        usage = Usage.add(usage, error.usage);
      } else {
        usage = Usage.add(usage, failedCompletionUsage);
      }
      this.runState = "closing";
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
    let usage = Usage.empty();
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    const bufferOutputDeltas = hasEnforcedOutputGuardrails(this.guardrailPolicies);
    let runObservers: ActiveAgentRunObservers | undefined;
    let pendingTurnMessages: MessageType[] = [];

    try {
      this.throwIfCancelled();
      const memoryPreparation =
        this.continuationState === undefined
          ? await this.memoryRecorder.prepareHistory(
              runId,
              newMessages,
              this.abortController.signal,
            )
          : undefined;
      if (memoryPreparation !== undefined) {
        this.chatHistory = memoryPreparation.history;
        usage = Usage.add(usage, memoryPreparation.usage);
        this.memoryCompaction = memoryPreparation.compaction;
        await this.notifyInternalMemoryCompaction(memoryPreparation.compaction);
      }
      runObservers = await this.startRunObservers(runId);
      if (memoryPreparation !== undefined) {
        await this.recordMemoryCompaction(memoryPreparation, runObservers);
      }
      if (memoryPreparation?.compaction !== undefined) {
        yield { type: "memory_compaction", ...memoryPreparation.compaction };
      }
      this.throwIfCancelled();
      await this.activeLifecycle?.onStart?.({
        runId,
        input: lifecycleSnapshot(this.promptMessage),
        history: lifecycleSnapshot(this.chatHistory),
        maxTurns: this.maxTurnCount,
      });
      if (this.continuationState === undefined) {
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
          const result: AgentBlockedOutcome = {
            type: "blocked",
            stage: "input",
            ...blockedOutcomeDetails(
              this.guardrailDecisions,
              "The request was blocked by a guardrail.",
            ),
            runId,
            text,
            usage,
            messages: [this.promptMessage, { role: "assistant", content: text }],
            trace: runObservers.trace,
            guardrails: [...this.guardrailDecisions],
            ...this.memoryCompactionResult(),
          };
          if (this.resumedFrom !== undefined) result.resumedFrom = this.resumedFrom;
          this.runState = "closing";
          await this.runLifecycleFinish(result);
          await runObservers.end(observerRunEnd(result));
          this.runState = "completed";
          this.disposeAbortLink();
          yield result;
          return;
        }
      }

      newMessages = [this.promptMessage];
      await this.memoryRecorder.commitAcceptedInput(runId, newMessages);
      pendingTurnMessages = this.memoryRecorder.pendingTurnMessages(newMessages);
      await this.runRunStartHook(newMessages);
      if (this.continuationState !== undefined) {
        const responsePart =
          this.promptMessage.role === "tool" ? this.promptMessage.content[0] : undefined;
        if (responsePart === undefined || responsePart.type === "tool-result") {
          throw new TypeError("Agent continuation response message is invalid.");
        }
        yield {
          type: "interaction_response",
          response: responsePart,
          sourceRunId: this.resumedFrom?.runId ?? this.continuationState.kind,
        };
        try {
          const execution = this.executeContinuationToolStream(runId, newMessages, {
            turn: 1,
            runObservers,
          });
          for await (const event of execution.events) {
            yield { turn: 1, ...event };
          }
          const toolResults = await execution.results;
          const toolMessage: MessageType = { role: "tool", content: toolResults };
          newMessages.push(toolMessage);
          await this.memoryRecorder.commitMessages(runId, 1, [toolMessage], pendingTurnMessages);
          for (const receipt of await this.drainSteeringMessages(
            runId,
            1,
            newMessages,
            pendingTurnMessages,
          )) {
            yield { type: "steering_applied", id: receipt.id, turn: 1 };
          }
          await this.memoryRecorder.commitCompletedTurn(runId, 1, pendingTurnMessages);
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            const result = await this.finishSuspension({
              runId,
              turn: 1,
              usage,
              newMessages,
              pendingTurnMessages,
              runObservers,
              suspension: error,
              uncommittedMessages: [],
            });
            yield result;
            return;
          }
          throw error;
        }
      }
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
        const bufferResponseEvents =
          this.shouldBufferStreamResponseEvents() || this.agent.outputSchema !== undefined;
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

        let generationEndArgs: AgentGenerationEndArgs = {
          turn: currentTurns,
          response,
        };
        if (firstDeltaMs !== undefined) {
          generationEndArgs = { ...generationEndArgs, firstDeltaMs };
        }
        this.activeGeneration = undefined;
        await generationObservers.end(generationEndArgs);
        response = await this.runCompletionResponseMiddlewares(request, response, currentTurns);
        try {
          assertCompletionResponseIntegrity({ response });
        } catch (error) {
          const providerOutputUsage = completionProviderOutputErrorUsage(error);
          if (providerOutputUsage !== undefined) usage = Usage.add(usage, providerOutputUsage);
          throw error;
        }
        usage = Usage.add(usage, response.usage);
        this.updateRunProgress(newMessages);
        await this.runCompletionResponseHook(prompt, response, newMessages);
        await this.runTurnEndHook(currentTurns, response, newMessages);
        await this.activeLifecycle?.onStepFinish?.({
          runId,
          step: currentTurns,
          response: lifecycleSnapshot(response),
          usage: lifecycleSnapshot(usage),
        });

        const toolCalls = response.choice.filter(
          (item): item is ToolCallPart => item.type === "tool-call",
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
          const appliedSteering = await this.drainSteeringMessages(
            runId,
            currentTurns,
            newMessages,
            pendingTurnMessages,
            { closeWhenEmpty: true },
          );
          for (const receipt of appliedSteering) {
            yield { type: "steering_applied", id: receipt.id, turn: currentTurns };
          }
          if (appliedSteering.length > 0) {
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
            if (!emittedToolCallIds.has(toolCall.toolCallId)) {
              yield { type: "tool_call", turn: currentTurns, toolCall };
            }
          }
        }
        this.updateRunProgress(newMessages);
        yield {
          type: "turn_end",
          turn: currentTurns,
          response: response as CompletionResponse<RawResponseOf<M>>,
          firstDeltaMs,
        };

        let toolResults: ToolResultPart[];
        try {
          const toolExecution = this.executeStreamingToolCalls(runId, toolCalls, newMessages, {
            turn: currentTurns,
            runObservers,
            toolDefinitions: request.tools,
          });
          for await (const result of toolExecution.events) {
            yield { turn: currentTurns, ...result };
          }
          toolResults = await toolExecution.results;
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            const result = await this.finishSuspension({
              runId,
              turn: currentTurns,
              usage,
              newMessages,
              pendingTurnMessages,
              runObservers,
              suspension: error,
              uncommittedMessages: [assistantMessage],
            });
            yield result;
            return;
          }
          throw error;
        }
        const toolMessage: MessageType = { role: "tool", content: toolResults };
        newMessages.push(toolMessage);
        await this.memoryRecorder.commitMessages(
          runId,
          currentTurns,
          [assistantMessage, toolMessage],
          pendingTurnMessages,
        );
        for (const receipt of await this.drainSteeringMessages(
          runId,
          currentTurns,
          newMessages,
          pendingTurnMessages,
        )) {
          yield { type: "steering_applied", id: receipt.id, turn: currentTurns };
        }
        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      if (error instanceof MemoryCompactionError && error.usage !== undefined) {
        usage = Usage.add(usage, error.usage);
      }
      if (error instanceof AgentStructuredOutputError) {
        usage = Usage.add(usage, error.usage);
      }
      this.runState = "closing";
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
      if (this.runState === "running" || this.runState === "closing") {
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
    request: CompletionRequest,
    turn: number,
    runObservers: ActiveAgentRunObservers,
  ): Promise<CompletionResponse> {
    assertCompletionRequestSupported(this.agent.model, request);
    this.validatedStructuredOutput = undefined;
    this.failedCompletionUsage = Usage.empty();
    const providerRequest = this.providerTraceRequest(request);
    const generationObservers = await runObservers.startGeneration(
      this.generationStartArgs(turn, request, providerRequest),
    );
    let currentRequest = request;
    let failedAttemptUsage = Usage.empty();
    try {
      for (let attempt = 1; ; attempt += 1) {
        let response: CompletionResponse;
        try {
          this.throwIfCancelled();
          response = await this.agent.model.completion(currentRequest, this.modelCallOptions());
          assertCompletionResponseIntegrity({ response });
        } catch (error) {
          const attemptUsage = completionProviderOutputErrorUsage(error);
          if (attemptUsage !== undefined) {
            failedAttemptUsage = Usage.add(failedAttemptUsage, attemptUsage);
            this.failedCompletionUsage = failedAttemptUsage;
          }
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
            providerOutputRetryEventAttributes(error, failedAttemptUsage),
          );
          continue;
        }

        const cumulativeUsage = Usage.add(failedAttemptUsage, response.usage);
        try {
          this.validateStructuredResponse(response, attempt, cumulativeUsage);
        } catch (error) {
          const retryOptions = this.retryOptionsForFailure(error, attempt, turn, false);
          if (retryOptions === undefined) {
            throw error;
          }
          failedAttemptUsage = cumulativeUsage;
          this.failedCompletionUsage = failedAttemptUsage;
          const retryRequest = structuredOutputRetryRequest(request, response, error);
          currentRequest = retryRequest.request;
          await this.scheduleCompletionRetry(
            error,
            attempt,
            turn,
            false,
            retryOptions,
            runObservers,
            structuredOutputRetryEventAttributes(error, retryRequest),
          );
          continue;
        }

        const finalResponse = Usage.isEmpty(failedAttemptUsage)
          ? response
          : { ...response, usage: cumulativeUsage };
        await generationObservers.end({ turn, response: finalResponse });
        this.failedCompletionUsage = Usage.empty();
        return finalResponse;
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
  ): Promise<CompletionRequest> {
    const ragText = extractRagText(prompt);
    const abortSignal = this.abortController.signal;
    const documents = await fetchContextDocuments(this.agent, ragText, abortSignal);
    const toolDefinitions = await fetchToolDefinitions(this.agent, ragText, abortSignal);
    const request = createCompletionRequest(providerMessages([...history, prompt]), {
      instructions: this.agent.instructions,
      documents,
      tools: [...toolDefinitions, ...getAgentToolState(this.agent).providerTools],
      temperature: this.agent.temperature,
      maxTokens: this.agent.maxTokens,
      providerOptions: this.agent.providerOptions,
      toolChoice: this.agent.toolChoice,
      controls: this.controls,
      outputSchema: getAgentProviderOutputSchema(this.agent),
    });
    return this.runCompletionRequestMiddlewares(request, turn);
  }

  private async *streamCompletion(args: {
    request: CompletionRequest;
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
    this.validatedStructuredOutput = undefined;
    let currentRequest = args.request;
    for (let attempt = 1; ; attempt += 1) {
      const accumulator = new CompletionStreamAccumulator();
      let hasProviderProgress = false;
      let recordedErrorUsage = false;
      let attemptErrorUsage: Usage | undefined;
      try {
        this.throwIfCancelled();
        for await (const event of model.streamCompletion(currentRequest, this.modelCallOptions())) {
          if (event.type === "error") {
            const eventUsage = event.usage ?? completionProviderOutputErrorUsage(event.error);
            if (eventUsage !== undefined) {
              args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, eventUsage);
              recordedErrorUsage = true;
              attemptErrorUsage = eventUsage;
            }
            throw event.error;
          }
          const mapped = accumulator.accept(event);
          if (event.type === "final") break;
          if (event.type === "tool_call_delta" || mapped !== undefined) {
            hasProviderProgress = true;
          }
          if (args.state.firstDeltaMs === undefined && isGenerationDeltaEvent(event.type)) {
            args.state.firstDeltaMs = Date.now() - args.generationStartedAt;
          }
          if (event.type === "tool_call_delta") {
            yield addTurnToToolCallDelta(args.turn, event);
          }
          if (mapped !== undefined) {
            await args.generationObservers.update?.({ turn: args.turn, delta: mapped });
            if (mapped.type === "tool_call") {
              args.state.emittedToolCallIds.add(mapped.toolCall.toolCallId);
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
        const response = accumulator.response();
        assertCompletionResponseIntegrity({ response });
        const cumulativeStructuredUsage = Usage.add(args.state.providerErrorUsage, response.usage);
        try {
          this.validateStructuredResponse(response, attempt, cumulativeStructuredUsage);
        } catch (error) {
          const retryOptions = this.retryOptionsForFailure(error, attempt, args.turn, true);
          if (retryOptions === undefined) {
            if (error instanceof AgentStructuredOutputError) {
              args.state.providerErrorUsage = Usage.empty();
            }
            throw error;
          }
          args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, response.usage);
          args.state.firstDeltaMs = undefined;
          args.state.emittedToolCallIds.clear();
          const retryRequest = structuredOutputRetryRequest(args.request, response, error);
          currentRequest = retryRequest.request;
          await this.scheduleCompletionRetry(
            error,
            attempt,
            args.turn,
            true,
            retryOptions,
            args.runObservers,
            structuredOutputRetryEventAttributes(error, retryRequest),
          );
          continue;
        }
        args.state.response = Usage.isEmpty(args.state.providerErrorUsage)
          ? response
          : { ...response, usage: cumulativeStructuredUsage };
        args.state.providerErrorUsage = Usage.empty();
        return;
      } catch (error) {
        if (!recordedErrorUsage) {
          const attemptUsage = completionProviderOutputErrorUsage(error);
          if (attemptUsage !== undefined) {
            args.state.providerErrorUsage = Usage.add(args.state.providerErrorUsage, attemptUsage);
            attemptErrorUsage = attemptUsage;
          }
        }
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
          providerOutputRetryEventAttributes(
            error,
            args.state.providerErrorUsage,
            attemptErrorUsage,
          ),
        );
      }
    }
  }

  private async *completeStreamingRun(args: {
    runId: string;
    turn: number;
    request: CompletionRequest;
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
    if (result.type === "response") {
      await this.runRunEndHook(result, args.newMessages);
    }
    await this.memoryRecorder.commitCompletedRun(
      args.runId,
      args.turn,
      args.newMessages,
      args.pendingTurnMessages,
    );
    await this.runLifecycleFinish(result);
    await args.runObservers.end(observerRunEnd(result));
    this.runState = "completed";
    this.disposeAbortLink();
    yield result;
  }

  private async finishSuspension(args: {
    runId: string;
    turn: number;
    usage: Usage;
    newMessages: MessageType[];
    pendingTurnMessages: MessageType[];
    runObservers: ActiveAgentRunObservers;
    suspension: ToolExecutionSuspension;
    uncommittedMessages: MessageType[];
  }): Promise<AgentInteractionOutcome> {
    const partialToolMessage: MessageType | undefined =
      args.suspension.completedResults.length === 0
        ? undefined
        : { role: "tool", content: [...args.suspension.completedResults] };
    if (partialToolMessage !== undefined) {
      args.newMessages.push(partialToolMessage);
      args.uncommittedMessages.push(partialToolMessage);
    }
    await this.memoryRecorder.commitMessages(
      args.runId,
      args.turn,
      args.uncommittedMessages,
      args.pendingTurnMessages,
    );
    await this.memoryRecorder.commitCompletedRun(
      args.runId,
      args.turn,
      args.newMessages,
      args.pendingTurnMessages,
    );

    this.runState = "closing";

    const continuationState: AgentContinuationState = {
      kind: "anvia.agent-continuation",
      history: [...this.chatHistory],
      messages: [...args.newMessages],
      pending: args.suspension.pending,
      remainingToolCalls: [...args.suspension.remainingToolCalls],
      steering: this.steeringMessages.map((entry) => ({
        id: entry.id,
        messages: [...entry.messages],
      })),
    };
    if (this.memoryScope !== undefined) continuationState.memoryScope = this.memoryScope;
    const continuation = parseAgentContinuation({
      version: 1,
      agentId: this.agent.id,
      sourceRunId: args.runId,
      interaction: args.suspension.interaction,
      state: serializeContinuationState(continuationState),
    });
    const result: AgentInteractionOutcome = {
      type: "interaction",
      runId: args.runId,
      text: latestAssistantText([...this.chatHistory, ...args.newMessages]),
      usage: args.usage,
      messages: [...args.newMessages],
      trace: args.runObservers.trace,
      guardrails: [...this.guardrailDecisions],
      interaction: continuation.interaction,
      continuation,
      ...generationArtifacts([...this.chatHistory, ...args.newMessages]),
      ...this.memoryCompactionResult(),
    };
    if (this.resumedFrom !== undefined) result.resumedFrom = this.resumedFrom;
    await this.runLifecycleFinish(result);
    await args.runObservers.end(observerRunEnd(result));
    this.runState = "completed";
    this.currentMessages = [...args.newMessages];
    this.disposeAbortLink();
    return result;
  }

  private generatedAssistantMessage(
    response: CompletionResponse,
    _request: CompletionRequest,
  ): MessageType {
    const generation: JsonObject = {
      provider: this.agent.model.provider,
      modelId: this.agent.model.modelId,
      usage: { ...response.usage },
    };
    if (response.finishReason !== undefined) generation.finishReason = response.finishReason;
    if (response.providerFinishReason !== undefined) {
      generation.providerFinishReason = response.providerFinishReason;
    }
    if (response.contextUsage !== undefined) generation.contextUsage = response.contextUsage;
    if (response.sources !== undefined) generation.sources = response.sources;
    if (response.providerToolCalls !== undefined) {
      generation.providerToolCalls = response.providerToolCalls;
    }
    const metadata: JsonObject = { anvia: { generation } };
    let message: MessageType = {
      role: "assistant",
      content: response.choice,
      metadata,
    };
    if (response.messageId !== undefined) message = { ...message, id: response.messageId };
    return message;
  }

  private providerTraceRequest(
    request: CompletionRequest,
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
    request: CompletionRequest,
    providerRequest: JsonObject | undefined,
  ): AgentGenerationStartArgs & { modelInfo: AgentGenerationModelInfo } {
    let args: AgentGenerationStartArgs & { modelInfo: AgentGenerationModelInfo } = {
      turn,
      request,
      modelInfo: {
        provider: this.agent.model.provider,
        modelId: this.agent.model.modelId,
        capabilities: this.agent.model.capabilities,
      },
    };
    if (providerRequest !== undefined) args = { ...args, providerRequest };
    return args;
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
    additionalAttributes?: JsonObject | undefined,
  ): Promise<void> {
    const delayMs = retryDelayMs(options, attempt);
    const attributes: JsonObject = {
      turn,
      attempt,
      nextAttempt: attempt + 1,
      maxAttempts: options.maxAttempts,
      delayMs,
      streaming,
      ...retryErrorAttributes(error),
    };
    if (additionalAttributes !== undefined) {
      Object.assign(attributes, additionalAttributes);
    }
    await runObservers.event({
      name: "completion.retry",
      level: "WARNING",
      attributes,
    });
    await waitForRetry(delayMs, this.abortController.signal);
  }

  private async executeToolCalls(
    runId: string,
    toolCalls: ToolCallPart[],
    newMessages: MessageType[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResultPart[]> {
    const executor = this.createToolExecutor(runId, newMessages);
    return executor.execute(toolCalls, onResult, onStreamEvent, observation);
  }

  private createToolExecutor(runId: string, newMessages: MessageType[]): ToolCallExecutor {
    return new ToolCallExecutor(
      this.agent,
      this.activeHook,
      async (request) => {
        throw new AgentInteractionSignal(approvalInteraction(request), request.rejectMessage);
      },
      this.activeLifecycle,
      {
        runId,
        sessionId: this.memoryScope?.sessionId,
        metadata: this.memoryScope?.metadata,
      },
      this.concurrency,
      this.requestMiddlewares,
      this.abortController.signal,
      (reason) => this.cancelled(newMessages, reason),
    );
  }

  private async resolveContinuationTools(
    runId: string,
    newMessages: MessageType[],
    onResult: ((result: ToolResultEventPayload) => void) | undefined,
    onStreamEvent: ((event: AgentToolEventPayload) => void) | undefined,
    observation: ToolExecutionObservation,
  ): Promise<ToolResultPart[]> {
    const state = this.continuationState;
    const response = this.interactionResponse;
    if (state === undefined || response === undefined) {
      return [];
    }
    const pending = state.pending;
    const interaction = this.resumedFrom;
    if (interaction === undefined) {
      throw new TypeError("Agent continuation is missing its source run linkage.");
    }
    const executor = this.createToolExecutor(runId, newMessages);
    const results: ToolResultPart[] = [];
    if (response.type === "tool-approval") {
      const attributes: JsonObject = {
        approvalId: interaction.interactionId,
        toolName: pending.toolCall.toolName,
        toolCallId: pending.toolCall.toolCallId,
        internalCallId: pending.internalCallId,
        approved: response.approved,
      };
      if (response.reason !== undefined) attributes.decisionReason = response.reason;
      await observation.runObservers.event({
        name: "tool.approval_resolved",
        attributes,
      });
      if (response.approved) {
        results.push(await executor.executeResumed(pending, onResult, onStreamEvent, observation));
      } else {
        const output = {
          type: "execution-denied" as const,
          reason: response.reason ?? pending.rejectMessage ?? "Tool approval was rejected.",
        };
        results.push(await executor.resolveResumed(pending, output, onResult, observation));
      }
    } else {
      const currentTool = this.agent.getTool(pending.toolCall.toolName);
      if (currentTool === undefined || !isQuestionTool(currentTool)) {
        throw new TypeError(
          `Cannot resume question interaction because tool "${pending.toolCall.toolName}" is no longer registered as a question tool.`,
        );
      }
      const output = questionResult(response.answers);
      results.push(await executor.resolveResumed(pending, output, onResult, observation));
    }
    try {
      results.push(
        ...(await executor.execute(state.remainingToolCalls, onResult, onStreamEvent, observation)),
      );
    } catch (error) {
      if (error instanceof ToolExecutionSuspension) {
        error.completedResults = [...results, ...error.completedResults];
      }
      throw error;
    }
    return results;
  }

  private executeStreamingToolCalls(
    runId: string,
    toolCalls: ToolCallPart[],
    newMessages: MessageType[],
    observation: ToolExecutionObservation,
  ): {
    events: AsyncIterable<ToolExecutionEventPayload>;
    results: Promise<ToolResultPart[]>;
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

  private executeContinuationToolStream(
    runId: string,
    newMessages: MessageType[],
    observation: ToolExecutionObservation,
  ): {
    events: AsyncIterable<ToolExecutionEventPayload>;
    results: Promise<ToolResultPart[]>;
  } {
    const events = createAsyncQueue<ToolExecutionEventPayload>();
    const results = this.resolveContinuationTools(
      runId,
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

  private async closeActiveGeneration(error: unknown): Promise<void> {
    const active = this.activeGeneration;
    if (active === undefined) {
      return;
    }
    this.activeGeneration = undefined;
    await active.observers.error({ turn: active.turn, error });
  }

  private updateRunProgress(messages: MessageType[]): void {
    this.currentMessages = [...messages];
  }

  private async runLifecycleFinish(result: AgentTerminalResult<Output>): Promise<void> {
    const common = {
      runId: result.runId,
      text: result.text,
      usage: lifecycleSnapshot(result.usage),
      messages: lifecycleSnapshot(result.messages),
    };
    if (result.memoryCompaction !== undefined) {
      Object.assign(common, { memoryCompaction: lifecycleSnapshot(result.memoryCompaction) });
    }
    const event =
      result.type === "response"
        ? {
            ...common,
            status: "completed",
            output: lifecycleSnapshot(result.output),
          }
        : result.type === "blocked"
          ? {
              ...common,
              status: "blocked",
              stage: result.stage,
            }
          : {
              ...common,
              status: "suspended",
              interaction: lifecycleSnapshot(result.interaction),
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
        this.onInternalFailure?.({
          error: reportedError,
          messages: lifecycleSnapshot(messages),
        }),
      () =>
        runObservers?.error({
          status: reportedError instanceof AgentRunCancelledError ? "cancelled" : "failed",
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
      // Thrown hook errors are diagnostic cleanup and must not replace the run failure.
    }
    const reportedError = this.cancellationError ?? error;
    await this.runLifecycleError(reportedError, runId, usage, messages);
    return reportedError;
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
        choice: [{ type: "text", text }],
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
      ...this.memoryCompactionResult(),
    };
    if (this.resumedFrom !== undefined) Object.assign(common, { resumedFrom: this.resumedFrom });
    if (blocked) {
      return {
        ...common,
        type: "blocked",
        stage: "output",
        ...blockedOutcomeDetails(
          this.guardrailDecisions,
          "The response was blocked by a guardrail.",
        ),
      };
    }
    return {
      ...common,
      type: "response",
      output: this.parseOutput(text),
    };
  }

  private validateStructuredResponse(
    response: CompletionResponse,
    attempt: number,
    usage: Usage,
  ): void {
    if (this.agent.outputSchema === undefined) return;
    if (response.choice.some((item) => item.type === "tool-call")) return;
    const text = textFromAssistantContent(response.choice);
    const normalized = normalizeStructuredOutput(text);
    if (response.finishReason === "content-filter") {
      throw new AgentStructuredOutputError({
        phase: "content-filter",
        attempt,
        maxAttempts: this.completionRetryOptions?.maxAttempts ?? 1,
        outputLength: text.length,
        normalizedLength: normalized.text.length,
        outputFormat: normalized.format,
        attemptUsage: response.usage,
        usage,
        finishReason: response.finishReason,
        providerFinishReason: response.providerFinishReason,
      });
    }
    if (response.finishReason === "length") {
      throw new AgentStructuredOutputError({
        phase: "truncated",
        attempt,
        maxAttempts: this.completionRetryOptions?.maxAttempts ?? 1,
        outputLength: text.length,
        normalizedLength: normalized.text.length,
        outputFormat: normalized.format,
        attemptUsage: response.usage,
        usage,
        finishReason: response.finishReason,
        providerFinishReason: response.providerFinishReason,
      });
    }
    const output = this.parseOutput(text, attempt, usage, {
      useValidatedOutput: false,
      attemptUsage: response.usage,
      finishReason: response.finishReason,
      providerFinishReason: response.providerFinishReason,
    });
    this.validatedStructuredOutput = { text, output };
  }

  private takeFailedCompletionUsage(): Usage {
    const usage = this.failedCompletionUsage;
    this.failedCompletionUsage = Usage.empty();
    return usage;
  }

  private parseOutput(
    text: string,
    attempt = 1,
    usage = Usage.empty(),
    options: {
      useValidatedOutput?: boolean;
      attemptUsage?: Usage;
      finishReason?: CompletionFinishReason | undefined;
      providerFinishReason?: string | undefined;
    } = {},
  ): Output {
    const schema = this.agent.outputSchema;
    if (schema === undefined) return text as Output;
    if (options.useValidatedOutput !== false && this.validatedStructuredOutput?.text === text) {
      return this.validatedStructuredOutput.output;
    }
    const normalized = normalizeStructuredOutput(text);
    const maxAttempts = this.completionRetryOptions?.maxAttempts ?? 1;
    let json: unknown;
    try {
      json = JSON.parse(normalized.text);
      if (!isJsonValue(json)) {
        throw new TypeError("Agent structured output is not a JSON value.");
      }
    } catch (error) {
      throw new AgentStructuredOutputError({
        phase: "parse",
        attempt,
        maxAttempts,
        outputLength: text.length,
        normalizedLength: normalized.text.length,
        outputFormat: normalized.format,
        attemptUsage: options.attemptUsage ?? usage,
        usage,
        finishReason: options.finishReason,
        providerFinishReason: options.providerFinishReason,
        cause: error,
      });
    }
    try {
      return schema.parse(json);
    } catch (error) {
      throw new AgentStructuredOutputError({
        phase: "schema",
        attempt,
        maxAttempts,
        outputLength: text.length,
        normalizedLength: normalized.text.length,
        outputFormat: normalized.format,
        attemptUsage: options.attemptUsage ?? usage,
        usage,
        finishReason: options.finishReason,
        providerFinishReason: options.providerFinishReason,
        cause: error,
      });
    }
  }

  private memoryCompactionResult(): {
    memoryCompaction?: MemoryCompactionInfo | undefined;
  } {
    return this.memoryCompaction === undefined
      ? {}
      : { memoryCompaction: lifecycleSnapshot(this.memoryCompaction) };
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
        originalTokenCount: compaction.originalTokenCount,
        compactedTokenCount: compaction.compactedTokenCount,
        retainedTokenCount: compaction.retainedTokenCount,
        resultTokenCount: compaction.resultTokenCount,
        attempts: compaction.attempts,
        inputTokens: compaction.usage.inputTokens,
        outputTokens: compaction.usage.outputTokens,
        totalTokens: compaction.usage.totalTokens,
      },
    });
  }

  private async notifyInternalMemoryCompaction(
    compaction: MemoryCompactionInfo | undefined,
  ): Promise<void> {
    if (compaction === undefined) {
      return;
    }
    await this.onInternalMemoryCompaction?.(lifecycleSnapshot(compaction));
  }

  private guardrailRunContext(runId: string): GuardrailRunContext {
    const context: GuardrailRunContext = {
      agentId: this.agent.id,
      runId,
    };
    if (this.memoryScope !== undefined) {
      context.sessionId = this.memoryScope.sessionId;
      if (this.memoryScope.metadata !== undefined) {
        context.metadata = this.memoryScope.metadata;
      }
    }
    return context;
  }

  private async startRunObservers(runId: string): Promise<ActiveAgentRunObservers> {
    const observability = this.agent.observability;
    return startAgentRunObservers(
      observability?.observers ?? {},
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
      {
        primaryTrace: observability?.primaryTrace,
        errorPolicy: observability?.errorPolicy ?? "ignore",
      },
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
    request: CompletionRequest,
    turn: number,
  ): Promise<CompletionRequest> {
    let current = request;
    for (const middleware of this.activeMiddlewares()) {
      const replacement = await middleware.onCompletionRequest?.({
        turn,
        request: current,
        originalRequest: request,
      });
      if (replacement?.request !== undefined) {
        current = replacement.request;
        if (current.providerOptions !== undefined) {
          assertJsonObject(current.providerOptions, "providerOptions");
        }
      }
    }
    return current;
  }

  private async runCompletionResponseMiddlewares(
    request: CompletionRequest,
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
    options: { closeWhenEmpty?: boolean } = {},
  ): Promise<QueuedSteering[]> {
    const receipts = this.steeringMessages.splice(0);
    if (receipts.length === 0) {
      if (options.closeWhenEmpty === true) {
        this.runState = "closing";
      }
      return [];
    }
    const messages = receipts.flatMap((receipt) => receipt.messages);
    newMessages.push(...messages);
    await this.memoryRecorder.commitMessages(runId, turn, messages, pendingTurnMessages);
    return receipts;
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
    return this.runState !== "idle" && this.runState !== "running";
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

function normalizeAgentInput(
  agentId: string,
  input: AgentInput,
): {
  prompt: MessageType;
  history: MessageType[];
  scope?: MemoryScope | undefined;
  continuationState?: AgentContinuationState | undefined;
  interactionResponse?: AgentInteractionResponse | undefined;
  sourceRunId?: string | undefined;
  interactionId?: string | undefined;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Agent runs require one options object with prompt or messages.");
  }
  const hasContinuation = "continuation" in input && input.continuation !== undefined;
  const hasPrompt = "prompt" in input && input.prompt !== undefined;
  const hasMessages = "messages" in input && input.messages !== undefined;
  if (Number(hasContinuation) + Number(hasPrompt) + Number(hasMessages) !== 1) {
    throw new TypeError("Agent runs require exactly one of prompt, messages, or continuation.");
  }
  if (hasContinuation) {
    if (!("response" in input) || input.response === undefined) {
      throw new TypeError("Agent continuation runs require an interaction response.");
    }
    if ("session" in input && input.session !== undefined) {
      throw new TypeError("Agent continuations carry their memory scope and cannot use session.");
    }
    const continuation = parseAgentContinuation(input.continuation);
    if (continuation.agentId !== agentId) {
      throw new TypeError(
        `Agent continuation belongs to "${continuation.agentId}", not "${agentId}".`,
      );
    }
    const response = parseAgentInteractionResponse(input.response);
    assertAgentInteractionResponse(continuation.interaction, response);
    const state = parseContinuationState(continuation.state, continuation.interaction);
    let responsePart: ToolInteractionResponsePart;
    if (response.type === "tool-approval") {
      responsePart = {
        type: "tool-approval-response",
        interactionId: continuation.interaction.id,
        toolCallId: continuation.interaction.toolCallId,
        toolName: continuation.interaction.toolName,
        approved: response.approved,
      };
      if (response.reason !== undefined)
        responsePart = { ...responsePart, reason: response.reason };
    } else {
      responsePart = {
        type: "tool-question-response",
        interactionId: continuation.interaction.id,
        toolCallId: continuation.interaction.toolCallId,
        toolName: continuation.interaction.toolName,
        answers: response.answers,
      };
    }
    if (continuation.interaction.callId !== undefined) {
      responsePart = { ...responsePart, callId: continuation.interaction.callId };
    }
    const normalized = {
      prompt: parseMessage({ role: "tool", content: [responsePart] }),
      history: [...state.history, ...state.messages],
      continuationState: state,
      interactionResponse: response,
      sourceRunId: continuation.sourceRunId,
      interactionId: continuation.interaction.id,
    };
    if (state.memoryScope !== undefined) {
      Object.assign(normalized, { scope: normalizeMemoryScope(state.memoryScope) });
    }
    return normalized;
  }
  if (hasPrompt) {
    const prompt = input.prompt;
    if (
      typeof prompt !== "string" &&
      (typeof prompt !== "object" || prompt === null || prompt.role !== "user")
    ) {
      throw new TypeError("Agent prompt must be text or a user message.");
    }
    const parsedPrompt = parseMessage(
      typeof prompt === "string" ? { role: "user", content: prompt } : prompt,
    );
    if (parsedPrompt.role !== "user") {
      throw new TypeError("Agent prompt must be text or a user message.");
    }
    const normalized = {
      prompt: parsedPrompt,
      history: [],
    };
    if (input.session !== undefined) {
      Object.assign(normalized, { scope: normalizeMemoryScope(input.session) });
    }
    return normalized;
  }
  if (input.session !== undefined) {
    throw new TypeError("Agent messages cannot be combined with a persisted session.");
  }
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("Agent input transcript must contain at least one message.");
  }
  const parsedMessages = parseMessages(messages);
  const activePrompt = parsedMessages.at(-1);
  if (activePrompt === undefined) {
    throw new TypeError("Agent input transcript must contain at least one message.");
  }
  if (activePrompt.role !== "user") {
    throw new TypeError("Agent input transcript must end with a user message.");
  }
  return {
    prompt: activePrompt,
    history: parsedMessages.slice(0, -1),
  };
}

function normalizeSteeringInput(input: AgentSteerInput): MessageType[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Agent steering requires one options object with prompt or messages.");
  }
  const hasPrompt = "prompt" in input && input.prompt !== undefined;
  const hasMessages = "messages" in input && input.messages !== undefined;
  if (hasPrompt === hasMessages) {
    throw new TypeError("Agent steering requires exactly one of prompt or messages.");
  }
  if (hasPrompt) {
    const prompt = input.prompt;
    if (
      typeof prompt !== "string" &&
      (typeof prompt !== "object" || prompt === null || prompt.role !== "user")
    ) {
      throw new TypeError("Agent steering prompt must be text or a user message.");
    }
    const parsedPrompt = parseMessage(
      typeof prompt === "string" ? { role: "user", content: prompt } : prompt,
    );
    if (parsedPrompt.role !== "user") {
      throw new TypeError("Agent steering prompt must be text or a user message.");
    }
    return [parsedPrompt];
  }
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("Agent steering messages must contain at least one user message.");
  }
  const parsedMessages = parseMessages(messages);
  if (parsedMessages.some((message) => message.role !== "user")) {
    throw new TypeError("Agent steering messages must all be user messages.");
  }
  return parsedMessages;
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
      if (item.details === undefined) {
        if (item.text.length > 0) {
          events.push(reasoningDeltaEvent(turn, item.text, { id: item.id }));
        }
        continue;
      }

      for (const content of item.details) {
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

    if (item.type === "tool-call") {
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
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: import("../../completion/index").ContextUsage;
} {
  const sources = new Map<string, CompletionSource>();
  const providerToolCalls = new Map<string, ProviderToolCall>();
  let finishReason: CompletionFinishReason | undefined;
  let providerFinishReason: string | undefined;
  let contextUsage: import("../../completion/index").ContextUsage | undefined;
  for (const message of messages) {
    const metadata = getAssistantGenerationMetadata(message);
    if (metadata !== undefined) {
      finishReason = metadata.finishReason;
      providerFinishReason = metadata.providerFinishReason;
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
  const artifacts: {
    sources?: CompletionSource[];
    providerToolCalls?: ProviderToolCall[];
    finishReason?: CompletionFinishReason;
    providerFinishReason?: string;
    contextUsage?: import("../../completion/index").ContextUsage;
  } = {};
  if (sources.size > 0) artifacts.sources = [...sources.values()];
  if (providerToolCalls.size > 0) {
    artifacts.providerToolCalls = [...providerToolCalls.values()];
  }
  if (finishReason !== undefined) artifacts.finishReason = finishReason;
  if (providerFinishReason !== undefined) {
    artifacts.providerFinishReason = providerFinishReason;
  }
  if (contextUsage !== undefined) artifacts.contextUsage = contextUsage;
  return artifacts;
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
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }
      if (content.type === "file" && content.data.type === "text") {
        return [content.data.text];
      }
      return [];
    })
    .join("\n");
}

function latestAssistantText(messages: readonly MessageType[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return typeof message.content === "string"
        ? message.content
        : textFromAssistantContent(message.content);
    }
  }
  return "";
}

function structuredOutputRetryRequest(
  request: CompletionRequest,
  response: CompletionResponse,
  error: unknown,
): StructuredOutputRetryRequest {
  const truncated = error instanceof AgentStructuredOutputError && error.phase === "truncated";
  const correction: MessageType = {
    role: "user",
    content: truncated ? STRUCTURED_OUTPUT_TRUNCATED_RETRY_PROMPT : STRUCTURED_OUTPUT_RETRY_PROMPT,
  };
  if (truncated) {
    return {
      request: {
        ...request,
        chatHistory: [...request.chatHistory, correction],
      },
      previousResponse: "omitted",
      includedOutputLength: 0,
    };
  }
  const preview = structuredOutputRepairPreview(textFromAssistantContent(response.choice));
  if (preview.includedOutputLength === 0) {
    return {
      request: {
        ...request,
        chatHistory: [...request.chatHistory, correction],
      },
      previousResponse: "omitted",
      includedOutputLength: 0,
    };
  }
  const invalidResponse: MessageType = {
    role: "assistant",
    content: [{ type: "text", text: preview.text }],
  };
  return {
    request: {
      ...request,
      chatHistory: [...request.chatHistory, invalidResponse, correction],
    },
    previousResponse: "preview",
    includedOutputLength: preview.includedOutputLength,
  };
}

function structuredOutputRetryEventAttributes(
  error: unknown,
  retryRequest: StructuredOutputRetryRequest,
): JsonObject {
  const attributes: JsonObject = {
    previousResponse: retryRequest.previousResponse,
    includedOutputLength: retryRequest.includedOutputLength,
  };
  if (!(error instanceof AgentStructuredOutputError)) return attributes;
  Object.assign(attributes, {
    failurePhase: error.phase,
    outputLength: error.outputLength,
    normalizedLength: error.normalizedLength,
    attemptUsage: usageEventValue(error.attemptUsage),
    cumulativeUsage: usageEventValue(error.usage),
  });
  if (error.finishReason !== undefined) attributes.finishReason = error.finishReason;
  if (error.providerFinishReason !== undefined) {
    attributes.providerFinishReason = error.providerFinishReason;
  }
  return attributes;
}

function providerOutputRetryEventAttributes(
  error: unknown,
  cumulativeUsage: Usage,
  attemptUsage?: Usage | undefined,
): JsonObject | undefined {
  const resolvedAttemptUsage = attemptUsage ?? completionProviderOutputErrorUsage(error);
  if (resolvedAttemptUsage === undefined) return undefined;
  return {
    attemptUsage: usageEventValue(resolvedAttemptUsage),
    cumulativeUsage: usageEventValue(cumulativeUsage),
  };
}

function usageEventValue(usage: Usage): JsonObject {
  const value: JsonObject = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
  if (usage.details !== undefined) value.details = { ...usage.details };
  return value;
}

function providerMessages(messages: readonly MessageType[]): MessageType[] {
  const providerMessages: MessageType[] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      providerMessages.push(message);
      continue;
    }
    const results = message.content.filter((part) => part.type === "tool-result");
    if (results.length > 0) {
      providerMessages.push({ ...message, content: results });
    }
  }
  return providerMessages;
}

function guardrailDecisionAttributes(decision: GuardrailDecisionRecord): JsonObject {
  const attributes: JsonObject = {
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

function blockedOutcomeDetails(
  decisions: readonly GuardrailDecisionRecord[],
  fallbackReason: string,
): { reason: string; message?: string | undefined } {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];
    if (decision?.applied !== true || decision.action !== "block") continue;
    return decision.message === undefined
      ? { reason: decision.reason ?? fallbackReason }
      : { reason: decision.reason ?? fallbackReason, message: decision.message };
  }
  return { reason: fallbackReason };
}

function observerRunEnd<Output>(outcome: AgentOutcome<Output>): AgentRunEndArgs {
  const common = {
    runId: outcome.runId,
    text: outcome.text,
    usage: outcome.usage,
    messages: outcome.messages,
    sources: outcome.sources,
    providerToolCalls: outcome.providerToolCalls,
    resumedFrom: outcome.resumedFrom,
  };
  switch (outcome.type) {
    case "response":
      return { ...common, status: "completed", output: outcome.output };
    case "blocked":
      return { ...common, status: "blocked", stage: outcome.stage };
    case "interaction":
      return { ...common, status: "suspended", interaction: outcome.interaction };
  }
}
