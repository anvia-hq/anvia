import type { Agent } from "../../agent/agent";
import {
  AgentRunCancelledError,
  AgentStreamClosedError,
  AgentStructuredOutputError,
  MaxTurnsError,
} from "../../agent/errors";
import { type AgentInteractionResponse, parseAgentContinuation } from "../../agent/interactions";
import {
  type AgentFinishEvent,
  type AgentLifecycle,
  composeAgentLifecycle,
  lifecycleSnapshot,
} from "../../agent/lifecycle";
import { getAgentProviderOutputSchema } from "../../agent/output-schema";
import type {
  AgentBlockedOutcome,
  AgentInteractionOutcome,
  AgentOutcome,
  AgentRunOptions,
  AgentRunSettings,
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStreamEvent,
  AgentToolSelectionEvent,
} from "../../agent/run-types";
import { getAgentToolState } from "../../agent/tool-state";
import { type ContextBreakdown, estimateContextBreakdown } from "../../context/breakdown";
import {
  assertCompletionRequestSupported,
  type CompletionModel,
  type CompletionModelControls,
  type CompletionModelControlsOf,
  type CompletionRequest,
  type CompletionResponse,
  type JsonObject,
  type Message as MessageType,
  mergeCompletionControlValues,
  type ToolCallPart,
  type ToolResultPart,
  textFromAssistantContent,
  Usage,
} from "../../completion/index";
import { assertCompletionResponseIntegrity } from "../../completion/provider-output-error";
import {
  appendGuardrailPolicies,
  type GuardrailDecisionRecord,
  type GuardrailPolicy,
  type GuardrailRunContext,
  hasEnforcedOutputGuardrails,
  runInputGuardrails,
  runOutputGuardrails,
} from "../../guardrails";
import type { AgentHook } from "../hooks";
import { MemoryCompactionError } from "../../memory/errors";
import type { MemoryCompactionInfo, MemoryScope } from "../../memory/types";
import {
  type ActiveAgentRunObservers,
  ActiveGenerationObservers,
  startAgentRunObservers,
} from "../../observability/group";
import type {
  AgentGenerationEndArgs,
  AgentGenerationToolMatch,
  AgentTraceOptions,
} from "../../observability/types";
import {
  completionProviderOutputErrorUsage,
  type ResolvedRetryOptions,
  resolveRetryOptions,
} from "../../retry";
import type { AgentMiddleware } from "../../agent/middleware";
import { isQuestionTool } from "../../tool/question-tool";
import { abortError, throwIfAborted } from "../abort";
import { createAsyncQueue } from "../async-queue";
import { createCompletionRequest } from "../completion-request";
import { extractRagText } from "../rag-text";
import {
  buildGenerationStartArgs,
  type CompletionRunnerContext,
  estimatedGenerationContext,
  parseStructuredOutput,
  providerTraceRequest,
  reportedGenerationContext,
  runUncachedCompletion,
  runUncachedStreamingCompletion,
  type StreamingCompletionState,
} from "./completion-runner";
import {
  type AgentContinuationState,
  type QueuedSteering,
  questionResult,
  serializeContinuationState,
} from "./continuation-state";
import type { AgentRunExecutionStep } from "./execution";
import {
  abortReason,
  latestAssistantText,
  mcpToolNames,
  normalizeAgentInput,
  normalizeRequestedRunId,
  normalizeSteeringInput,
  providerMessages,
  textFromMessage,
  withMemoryScopeTrace,
} from "./input-normalization";
import { ToolExecutionSuspension } from "./interaction-suspension";
import type { LoopContextCheckpoint, PreparedLoopContext } from "./loop-context";
import { AgentRunMemory, type MemoryPreparation } from "./memory";
import {
  fetchContextDocuments,
  fetchToolDefinitions,
  type FetchedToolDefinitions,
} from "./retrieval";
import {
  runCompletionCallHook,
  runCompletionErrorHook,
  runCompletionRequestMiddlewares,
  runCompletionResponseHook,
  runCompletionResponseMiddlewares,
  runRunEndHook,
  runRunErrorHook,
  runRunStartHook,
  runTurnEndHook,
  runTurnStartHook,
  shouldBufferStreamResponseEvents,
} from "./run-hooks";
import { getInternalAgentRunOptions, type InternalAgentRunOptions } from "./run-options";
import {
  blockedOutcomeDetails,
  generatedAssistantMessage,
  generationArtifacts,
  guardrailDecisionAttributes,
  observerRunEnd,
  responseStreamEvents,
  settleFailureCleanup,
} from "./run-outcomes";
import { assertNonnegativeSafeInteger, assertPositiveSafeInteger } from "./run-validation";
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
  private generationPromptRef: AgentTraceOptions["promptRef"];
  private readonly turnContextBreakdowns = new Map<number, ContextBreakdown>();
  private completionRetryOptions: ResolvedRetryOptions | undefined;
  private readonly requestMiddlewares: AgentMiddleware[];
  private readonly controls: Readonly<Record<string, string>> | undefined;
  private readonly steeringMessages: QueuedSteering[] = [];
  private readonly execution: InternalAgentRunOptions["execution"];
  private runState: "idle" | "running" | "closing" | "completed" | "errored" | "cancelled" = "idle";
  private readonly memoryRecorder: AgentRunMemory;
  private readonly memoryScope: MemoryScope | undefined;
  private readonly onInternalFailure: InternalAgentRunOptions["onFailure"];
  private readonly beforeFinish: InternalAgentRunOptions["beforeFinish"];
  private readonly onSteeringApplied: InternalAgentRunOptions["onSteeringApplied"];
  private readonly onInternalMemoryCompaction: InternalAgentRunOptions["onMemoryCompaction"];
  private memoryCompaction: MemoryCompactionInfo | undefined;
  private loopContextCheckpoint: LoopContextCheckpoint | undefined;
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
    this.execution = internalOptions?.execution;
    this.activeHook = internalOptions?.hook;
    this.onInternalFailure = internalOptions?.onFailure;
    this.beforeFinish = internalOptions?.beforeFinish;
    this.onSteeringApplied = internalOptions?.onSteeringApplied;
    this.onInternalMemoryCompaction = internalOptions?.onMemoryCompaction;
    this.requestedRunId = normalizeRequestedRunId(internalOptions?.runId);
    this.activeLifecycle =
      internalOptions?.lifecycle !== undefined
        ? (internalOptions.lifecycle as AgentLifecycle<Output, unknown>)
        : (composeAgentLifecycle(agent.lifecycle, options.lifecycle) as
            | AgentLifecycle<Output, unknown>
            | undefined);

    if (internalOptions?.guardrails !== undefined) {
      this.guardrailPolicies = [...internalOptions.guardrails];
    } else {
      this.guardrailPolicies =
        options.guardrails === undefined
          ? [...agent.guardrails]
          : appendGuardrailPolicies([...agent.guardrails], options.guardrails);
    }

    const configuredConcurrency = assertPositiveSafeInteger(
      options.toolConcurrency ?? 1,
      "toolConcurrency",
    );
    this.concurrency = this.activeHook !== undefined ? 1 : configuredConcurrency;
    this.traceOptions = withMemoryScopeTrace(options.trace, options.memoryScope);
    const retrySetting = options.retries === undefined ? agent.retries : options.retries;
    this.completionRetryOptions =
      retrySetting === undefined || retrySetting === false
        ? undefined
        : resolveRetryOptions(retrySetting);
    this.requestMiddlewares = [...(options.middlewares ?? [])];
    this.controls = mergeCompletionControlValues(agent.controls, options.controls);
    this.memoryScope = options.memoryScope;
    this.memoryRecorder = new AgentRunMemory(
      agent,
      options.memoryScope,
      initialHistory,
      internalOptions?.memory?.store,
    );
    this.continuationState = options.continuationState;
    this.loopContextCheckpoint = options.continuationState?.loopContextCheckpoint;
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
      memoryScope: normalized.scope ?? getInternalAgentRunOptions(options)?.memory?.scope,
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

  async generate(): Promise<AgentTerminalResult<Output>> {
    for await (const event of this.executeRun(false)) {
      if (event.type === "response" || event.type === "blocked" || event.type === "interaction") {
        return event;
      }
    }
    throw new Error("AgentRun completed without a terminal outcome.");
  }

  events(): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    return this.executeRun(true);
  }

  private async *executeRun(
    streaming: boolean,
  ): AsyncIterable<AgentStreamEvent<Output, RawResponseOf<M>>> {
    this.startRun();
    const runId = this.requestedRunId ?? globalThis.crypto.randomUUID();
    const usageState = { value: Usage.empty() };
    let currentTurns = 0;
    let lastPrompt = this.promptMessage;
    let newMessages: MessageType[] = [this.promptMessage];
    const bufferOutputDeltas = streaming && hasEnforcedOutputGuardrails(this.guardrailPolicies);
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
        usageState.value = Usage.add(usageState.value, memoryPreparation.usage);
        this.memoryCompaction = memoryPreparation.compaction;
        await this.notifyInternalMemoryCompaction(memoryPreparation.compaction);
      }

      runObservers = await this.startRunObservers(runId);

      if (memoryPreparation !== undefined) {
        await this.recordMemoryCompaction(memoryPreparation, runObservers);
      }

      if (streaming && memoryPreparation?.compaction !== undefined) {
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

          if (streaming) yield { type: "guardrail_decision", decision };
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
            usage: usageState.value,
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
      await runRunStartHook(this.activeHook, {
        prompt: this.promptMessage,
        history: this.chatHistory,
        maxTurns: this.maxTurnCount,
        newMessages,
        cancel: (messages, reason) => this.cancelled(messages, reason),
      });

      if (this.continuationState !== undefined) {
        await this.recordInteractionResponseEvent(runObservers);

        if (streaming) {
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
        }

        try {
          let toolResults: ToolResultPart[];

          if (streaming) {
            const execution = this.executeContinuationToolStream(runId, newMessages, {
              turn: 1,
              runObservers,
            });
            for await (const event of execution.events) {
              yield { turn: 1, ...event };
            }
            toolResults = await execution.results;
          } else {
            toolResults = await this.resolveContinuationTools(
              runId,
              newMessages,
              undefined,
              undefined,
              {
                turn: 1,
                runObservers,
              },
            );
          }

          const toolMessage: MessageType = { role: "tool", content: toolResults };
          newMessages.push(toolMessage);
          await this.memoryRecorder.commitMessages(runId, 1, [toolMessage], pendingTurnMessages);
          const drainedSteering = await this.drainSteeringMessages(
            runId,
            1,
            newMessages,
            pendingTurnMessages,
          );

          if (streaming) {
            for (const receipt of drainedSteering) {
              yield { type: "steering_applied", id: receipt.id, turn: 1 };
            }
          }

          await this.memoryRecorder.commitCompletedTurn(runId, 1, pendingTurnMessages);
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            const result = await this.finishSuspension({
              runId,
              turn: 1,
              usage: usageState.value,
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

      if (this.continuationState === undefined && this.execution?.drainSteering !== undefined) {
        await this.drainSteeringMessages(runId, 0, newMessages, pendingTurnMessages);
      }

      while (currentTurns <= this.maxTurnCount) {
        const prompt = newMessages.at(-1);

        if (prompt === undefined) {
          throw new Error("AgentRun requires at least one message");
        }

        lastPrompt = prompt;
        currentTurns += 1;

        const historyForRequest = [...this.chatHistory, ...newMessages.slice(0, -1)];

        if (streaming) {
          yield {
            type: "turn_start",
            turn: currentTurns,
            prompt,
            history: historyForRequest,
          };
        }

        const cancelFn = (messages: MessageType[], reason: string) =>
          this.cancelled(messages, reason);
        await runTurnStartHook(
          this.activeHook,
          currentTurns,
          prompt,
          historyForRequest,
          newMessages,
          cancelFn,
        );
        await runCompletionCallHook(
          this.activeHook,
          prompt,
          historyForRequest,
          newMessages,
          cancelFn,
        );

        const contextReplayed = await this.isReplayed({ kind: "context", turn: currentTurns });
        const prepared =
          this.execution?.prepareMessages !== undefined ||
          this.agent.memory?.compaction !== undefined
            ? await this.prepareTurnMessages(currentTurns, [...historyForRequest, prompt])
            : { messages: [...historyForRequest, prompt] };

        if (prepared.compaction !== undefined) {
          if (!contextReplayed) {
            usageState.value = Usage.add(usageState.value, prepared.compaction.usage);
          }

          this.memoryCompaction = prepared.compaction;
          await this.notifyInternalMemoryCompaction(prepared.compaction);

          if (!contextReplayed) await this.recordMemoryCompaction(prepared, runObservers);

          if (streaming) yield { type: "memory_compaction", ...prepared.compaction };
        }

        const { request, selection } = await this.createTurnRequest(
          prompt,
          prepared.messages,
          currentTurns,
        );

        if (streaming && selection !== undefined) yield selection;

        const modelReplayed = await this.isReplayed({ kind: "model", turn: currentTurns });
        const bufferResponseEvents =
          streaming &&
          (shouldBufferStreamResponseEvents(this.activeHook, this.activeMiddlewares()) ||
            this.agent.outputSchema !== undefined);
        let response: CompletionResponse;
        let firstDeltaMs: number | undefined;
        let emittedToolCallIds: Set<string> = new Set();

        if (streaming) {
          const turnStream = yield* this.executeStreamingTurn({
            turn: currentTurns,
            prompt,
            request,
            selection,
            modelReplayed,
            bufferResponseEvents,
            bufferOutputDeltas,
            newMessages,
            runObservers,
            usageState,
          });
          response = turnStream.response;
          firstDeltaMs = turnStream.firstDeltaMs;
          emittedToolCallIds = turnStream.emittedToolCallIds;
        } else {
          response = await this.executeNonStreamingTurn({
            turn: currentTurns,
            prompt,
            request,
            selection,
            newMessages,
            runObservers,
            usageState,
          });
        }

        if (!modelReplayed) usageState.value = Usage.add(usageState.value, response.usage);

        this.updateRunProgress(newMessages);
        await runCompletionResponseHook(this.activeHook, prompt, response, newMessages, cancelFn);
        await runTurnEndHook(this.activeHook, currentTurns, response, newMessages, cancelFn);
        await this.activeLifecycle?.onStepFinish?.({
          runId,
          step: currentTurns,
          response: lifecycleSnapshot(response),
          usage: lifecycleSnapshot(usageState.value),
        });

        const toolCalls = response.choice.filter(
          (item): item is ToolCallPart => item.type === "tool-call",
        );
        const assistantMessage = generatedAssistantMessage(this.agent.model, response);
        newMessages.push(assistantMessage);

        if (toolCalls.length === 0) {
          await this.beforeFinish?.();
          let emittedTurnEnd = false;

          if (streaming && !bufferOutputDeltas) {
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

          if (appliedSteering.length > 0) {
            for (const receipt of appliedSteering) {
              await runObservers.event({
                name: "agent.steering_applied",
                attributes: { id: receipt.id, turn: currentTurns },
              });

              if (streaming) {
                yield { type: "steering_applied", id: receipt.id, turn: currentTurns };
              }
            }
            await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
            continue;
          }

          yield* this.completeRunResponse({
            streaming,
            runId,
            turn: currentTurns,
            response,
            firstDeltaMs,
            usage: usageState.value,
            newMessages,
            pendingTurnMessages,
            runObservers,
            bufferResponseEvents,
            bufferOutputDeltas,
            emittedTurnEnd,
          });
          return;
        }

        if (streaming) {
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
        }

        this.updateRunProgress(newMessages);

        if (streaming) {
          yield {
            type: "turn_end",
            turn: currentTurns,
            response: response as CompletionResponse<RawResponseOf<M>>,
            firstDeltaMs,
          };
        }

        let toolResults: ToolResultPart[];
        try {
          if (streaming) {
            const toolExecution = this.executeStreamingToolCalls(runId, toolCalls, newMessages, {
              turn: currentTurns,
              runObservers,
              toolDefinitions: request.tools,
            });
            for await (const result of toolExecution.events) {
              yield { turn: currentTurns, ...result };
            }
            toolResults = await toolExecution.results;
          } else {
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
          }
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            const result = await this.finishSuspension({
              runId,
              turn: currentTurns,
              usage: usageState.value,
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
        const drainedSteering = await this.drainSteeringMessages(
          runId,
          currentTurns,
          newMessages,
          pendingTurnMessages,
        );

        if (streaming) {
          for (const receipt of drainedSteering) {
            yield { type: "steering_applied", id: receipt.id, turn: currentTurns };
          }
        }

        await this.memoryRecorder.commitCompletedTurn(runId, currentTurns, pendingTurnMessages);
      }

      throw new MaxTurnsError(this.maxTurnCount, [...this.chatHistory, ...newMessages], lastPrompt);
    } catch (error) {
      if (error instanceof MemoryCompactionError && error.usage !== undefined) {
        usageState.value = Usage.add(usageState.value, error.usage);
      }

      const failedCompletionUsage = this.takeFailedCompletionUsage();

      if (error instanceof AgentStructuredOutputError) {
        usageState.value = Usage.add(usageState.value, error.usage);
      } else {
        usageState.value = Usage.add(usageState.value, failedCompletionUsage);
      }

      this.runState = "closing";
      const runError = this.normalizeRunError(error);
      const reportedError = await this.reportRunFailure(
        runError,
        runId,
        usageState.value,
        newMessages,
        runObservers,
      );
      this.runState = reportedError instanceof AgentRunCancelledError ? "cancelled" : "errored";
      this.disposeAbortLink();

      if (streaming) {
        yield { type: "error", error: reportedError, usage: usageState.value };
        return;
      }

      throw reportedError;
    } finally {
      if (this.runState === "running" || this.runState === "closing") {
        const cancellation =
          this.cancellationError ??
          new AgentRunCancelledError([...this.chatHistory, ...newMessages], "Agent stream closed.");
        this.setCancellationError(cancellation);
        await settleFailureCleanup([() => this.closeActiveGeneration(cancellation)]);
        await this.reportRunFailure(
          cancellation,
          runId,
          usageState.value,
          newMessages,
          runObservers,
        );
        this.runState = "cancelled";
        this.disposeAbortLink();
      }
    }
  }

  private async executeNonStreamingTurn(args: {
    turn: number;
    prompt: MessageType;
    request: CompletionRequest;
    selection: AgentToolSelectionEvent | undefined;
    newMessages: MessageType[];
    runObservers: ActiveAgentRunObservers;
    usageState: { value: Usage };
  }): Promise<CompletionResponse> {
    let response: CompletionResponse;
    try {
      response = await this.runCompletion(
        args.request,
        args.turn,
        args.runObservers,
        args.selection?.matches,
      );
    } catch (error) {
      await settleFailureCleanup([
        () =>
          runCompletionErrorHook(
            this.activeHook,
            args.prompt,
            error,
            args.newMessages,
            (messages, reason) => this.cancelled(messages, reason),
          ),
      ]);
      throw error;
    }
    response = await runCompletionResponseMiddlewares(
      this.activeMiddlewares(),
      args.request,
      response,
      args.turn,
    );
    try {
      assertCompletionResponseIntegrity({ response });
    } catch (error) {
      const providerOutputUsage = completionProviderOutputErrorUsage(error);

      if (providerOutputUsage !== undefined) {
        args.usageState.value = Usage.add(args.usageState.value, providerOutputUsage);
      }

      throw error;
    }
    return response;
  }

  private async *executeStreamingTurn(args: {
    turn: number;
    prompt: MessageType;
    request: CompletionRequest;
    selection: AgentToolSelectionEvent | undefined;
    modelReplayed: boolean;
    bufferResponseEvents: boolean;
    bufferOutputDeltas: boolean;
    newMessages: MessageType[];
    runObservers: ActiveAgentRunObservers;
    usageState: { value: Usage };
  }): AsyncGenerator<
    AgentStreamEvent<Output, RawResponseOf<M>>,
    {
      response: CompletionResponse;
      firstDeltaMs: number | undefined;
      emittedToolCallIds: Set<string>;
    }
  > {
    assertCompletionRequestSupported(this.agent.model, args.request, { streaming: true });
    const providerRequest = providerTraceRequest(this.agent.model, args.request, { stream: true });
    const generationStartArgs = buildGenerationStartArgs({
      model: this.agent.model,
      turn: args.turn,
      request: args.request,
      promptRef: this.generationPromptRef,
      providerRequest,
      toolMatches: args.selection?.matches,
      context: this.turnContextBreakdowns.get(args.turn),
    });
    const generationObservers = args.modelReplayed
      ? new ActiveGenerationObservers([], "ignore")
      : await args.runObservers.startGeneration(generationStartArgs);
    this.activeGeneration = { turn: args.turn, observers: generationObservers };
    const generationStartedAt = Date.now();
    yield {
      type: "generation_start",
      turn: args.turn,
      request: args.request,
      modelInfo: generationStartArgs.modelInfo,
      promptRef: generationStartArgs.promptRef,
    };
    const completionState: StreamingCompletionState = {
      response: undefined,
      firstDeltaMs: undefined,
      emittedToolCallIds: new Set(),
      providerErrorUsage: Usage.empty(),
      attemptInputTokens: undefined,
    };
    const execute = () =>
      runUncachedStreamingCompletion(this.completionRunnerContext(), {
        request: args.request,
        turn: args.turn,
        bufferResponseEvents: args.bufferResponseEvents,
        bufferOutputDeltas: args.bufferOutputDeltas,
        generationStartedAt,
        generationObservers,
        runObservers: args.runObservers,
        state: completionState,
      });
    let response: CompletionResponse;
    try {
      try {
        if (this.execution !== undefined) {
          if (this.execution.streamCompletion === undefined) {
            throw new TypeError("The execution runtime does not support streaming checkpoints.");
          }

          response = yield* this.execution.streamCompletion(args.turn, args.request, execute);
        } else {
          response = yield* execute();
        }
      } finally {
        args.usageState.value = Usage.add(
          args.usageState.value,
          completionState.providerErrorUsage,
        );
      }
      let endArgs: AgentGenerationEndArgs = {
        turn: args.turn,
        response: completionState.response ?? response,
        ...reportedGenerationContext(
          this.turnContextBreakdowns.get(args.turn),
          completionState.attemptInputTokens ??
            (completionState.response ?? response).usage.inputTokens,
        ),
      };

      if (completionState.firstDeltaMs !== undefined) {
        endArgs = { ...endArgs, firstDeltaMs: completionState.firstDeltaMs };
      }

      this.activeGeneration = undefined;
      await generationObservers.end(endArgs);
      response = await runCompletionResponseMiddlewares(
        this.activeMiddlewares(),
        args.request,
        response,
        args.turn,
      );
      try {
        assertCompletionResponseIntegrity({ response });
      } catch (error) {
        const providerOutputUsage = completionProviderOutputErrorUsage(error);

        if (providerOutputUsage !== undefined) {
          args.usageState.value = Usage.add(args.usageState.value, providerOutputUsage);
        }

        throw error;
      }
    } catch (error) {
      await settleFailureCleanup([
        () => this.closeActiveGeneration(error),
        () =>
          runCompletionErrorHook(
            this.activeHook,
            args.prompt,
            error,
            args.newMessages,
            (messages, reason) => this.cancelled(messages, reason),
          ),
      ]);
      throw error;
    }

    return {
      response,
      firstDeltaMs: completionState.firstDeltaMs,
      emittedToolCallIds: completionState.emittedToolCallIds,
    };
  }

  private async *completeRunResponse(args: {
    streaming: boolean;
    runId: string;
    turn: number;
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

    if (args.streaming) {
      for (const decision of guardedOutput.decisions) {
        yield { type: "guardrail_decision", decision };
      }
    }

    const response = guardedOutput.response;
    const assistantMessage = generatedAssistantMessage(this.agent.model, response);
    args.newMessages[args.newMessages.length - 1] = assistantMessage;
    await this.memoryRecorder.commitMessages(
      args.runId,
      args.turn,
      [assistantMessage],
      args.pendingTurnMessages,
    );

    if (
      args.streaming &&
      !args.emittedTurnEnd &&
      (args.bufferResponseEvents || args.bufferOutputDeltas)
    ) {
      for (const event of responseStreamEvents(args.turn, response, args.bufferResponseEvents)) {
        yield event as AgentStreamEvent<Output, RawResponseOf<M>>;
      }
    }

    if (args.streaming && !args.emittedTurnEnd) {
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
      await runRunEndHook(this.activeHook, result, args.newMessages, (messages, reason) =>
        this.cancelled(messages, reason),
      );
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

  private completionRunnerContext(): CompletionRunnerContext<Output> {
    return {
      model: this.agent.model,
      outputSchema: this.agent.outputSchema,
      retryOptions: this.completionRetryOptions,
      abortSignal: this.abortController.signal,
      throwIfCancelled: () => this.throwIfCancelled(),
      getTurnContext: (turn) => this.turnContextBreakdowns.get(turn),
      setValidatedStructuredOutput: (validated) => {
        this.validatedStructuredOutput = validated;
      },
      getValidatedStructuredOutput: () => this.validatedStructuredOutput,
      recordFailedAttemptUsage: (usage) => {
        this.failedCompletionUsage = usage;
      },
    };
  }

  private runCompletion(
    request: CompletionRequest,
    turn: number,
    runObservers: ActiveAgentRunObservers,
    toolMatches?: readonly AgentGenerationToolMatch[] | undefined,
  ): Promise<CompletionResponse> {
    const execute = () =>
      runUncachedCompletion(this.completionRunnerContext(), {
        request,
        turn,
        runObservers,
        promptRef: this.generationPromptRef,
        toolMatches,
      });
    return this.execution === undefined
      ? execute()
      : this.execution.completion(turn, request, execute);
  }

  private async prepareTurnMessages(
    turn: number,
    messages: MessageType[],
  ): Promise<PreparedLoopContext> {
    let prepared: PreparedLoopContext;

    if (this.execution?.prepareMessages !== undefined) {
      prepared = await this.execution.prepareMessages(turn, messages, this.loopContextCheckpoint);
    } else if (
      turn > 1 ||
      this.continuationState !== undefined ||
      messages.some((message) => message.role === "tool")
    ) {
      prepared = await this.memoryRecorder.prepareLoop(
        messages,
        this.loopContextCheckpoint,
        this.abortController.signal,
      );
    } else {
      prepared = { messages };
    }

    if (prepared.checkpoint !== undefined) this.loopContextCheckpoint = prepared.checkpoint;

    return prepared;
  }

  private async createTurnRequest(
    prompt: MessageType,
    messages: readonly MessageType[],
    turn: number,
  ): Promise<{ request: CompletionRequest; selection: AgentToolSelectionEvent | undefined }> {
    const ragText = extractRagText(prompt);
    const abortSignal = this.abortController.signal;
    const selectContext = this.execution?.selectContext;
    const documents = await fetchContextDocuments(
      this.agent,
      ragText,
      abortSignal,
      selectContext === undefined
        ? undefined
        : (index, retrieve) => selectContext.call(this.execution, turn, index, retrieve),
    );
    const fetched = await this.selectTurnTools(turn, ragText, abortSignal);
    const toolDefinitions = fetched.definitions;
    const request = createCompletionRequest(providerMessages(messages), {
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
    const selection =
      fetched.matches.length === 0
        ? undefined
        : {
            type: "tool_selection" as const,
            turn,
            tools: toolDefinitions.map((definition) => definition.name),
            matches: fetched.matches,
          };
    const middlewareResult = await runCompletionRequestMiddlewares(
      this.activeMiddlewares(),
      request,
      turn,
      this.traceOptions?.promptRef,
    );
    this.generationPromptRef = middlewareResult.promptRef;
    const context = estimateContextBreakdown(middlewareResult.request, {
      mcpToolNames: mcpToolNames(this.agent),
    });
    this.turnContextBreakdowns.set(turn, context);
    return { request: middlewareResult.request, selection };
  }

  private async selectTurnTools(
    turn: number,
    ragText: string | undefined,
    abortSignal: AbortSignal,
  ): Promise<FetchedToolDefinitions> {
    if (this.execution?.selectTools === undefined) {
      return fetchToolDefinitions(this.agent, ragText, abortSignal);
    }

    let fetched: FetchedToolDefinitions = { definitions: [], matches: [] };
    const selected = await this.execution.selectTools(turn, async () => {
      fetched = await fetchToolDefinitions(this.agent, ragText, abortSignal);
      return fetched.definitions;
    });
    return { definitions: selected, matches: fetched.matches };
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

    if (this.loopContextCheckpoint !== undefined) {
      continuationState.loopContextCheckpoint = this.loopContextCheckpoint;
    }

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
      this.execution,
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
    await active.observers.error({
      turn: active.turn,
      error,
      ...estimatedGenerationContext(this.turnContextBreakdowns.get(active.turn)),
    });
  }

  private async recordInteractionResponseEvent(
    runObservers: ActiveAgentRunObservers,
  ): Promise<void> {
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
      trace: lifecycleSnapshot(result.trace),
    };
    let event: AgentFinishEvent<Output>;

    if (result.type === "response") {
      event = {
        ...common,
        status: "completed",
        output: lifecycleSnapshot(result.output),
      } as AgentFinishEvent<Output>;
    } else if (result.type === "blocked") {
      event = {
        ...common,
        status: "blocked",
        stage: result.stage,
      } as AgentFinishEvent<Output>;
    } else {
      event = {
        ...common,
        status: "suspended",
        interaction: lifecycleSnapshot(result.interaction),
      } as AgentFinishEvent<Output>;
    }

    await this.activeLifecycle?.onFinish?.(event);
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
      await runRunErrorHook(this.activeHook, {
        error,
        usage,
        chatHistory: this.chatHistory,
        newMessages: messages,
        cancel: (newMessages, reason) => this.cancelled(newMessages, reason),
      });
    } catch {
      void error;
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
      output: parseStructuredOutput(this.completionRunnerContext(), text),
    };
  }

  private takeFailedCompletionUsage(): Usage {
    const usage = this.failedCompletionUsage;
    this.failedCompletionUsage = Usage.empty();
    return usage;
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
    preparation: Pick<MemoryPreparation, "compaction">,
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

  private async isReplayed(step: AgentRunExecutionStep): Promise<boolean> {
    const pending = this.execution?.replayed?.(step) ?? false;
    return typeof pending === "boolean" ? pending : await pending;
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
        onObserverError: observability?.onObserverError,
      },
    );
  }

  private activeMiddlewares(): AgentMiddleware[] {
    return [...this.agent.middlewares, ...this.requestMiddlewares];
  }

  private async drainSteeringMessages(
    runId: string,
    turn: number,
    newMessages: MessageType[],
    pendingTurnMessages: MessageType[],
    options: { closeWhenEmpty?: boolean } = {},
  ): Promise<QueuedSteering[]> {
    const drainedPending = this.execution?.drainSteering?.(turn, options.closeWhenEmpty === true);
    const drained =
      drainedPending === undefined || Array.isArray(drainedPending)
        ? (drainedPending ?? [])
        : await drainedPending;
    const receipts = [...drained, ...this.steeringMessages.splice(0)];

    if (receipts.length === 0) {
      if (options.closeWhenEmpty === true) {
        this.runState = "closing";
      }

      return [];
    }

    const messages = receipts.flatMap((receipt) => receipt.messages);
    newMessages.push(...messages);
    await this.memoryRecorder.commitMessages(runId, turn, messages, pendingTurnMessages);
    for (const receipt of receipts) this.onSteeringApplied?.(receipt.id);
    return receipts;
  }

  private setCancellationError(error: AgentRunCancelledError): void {
    this.cancellationError = error;

    if (!this.abortController.signal.aborted) this.abortController.abort(error);
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

  private disposeAbortLink(): void {
    this.removeExternalAbortListener?.();
    this.removeExternalAbortListener = undefined;
  }
}
