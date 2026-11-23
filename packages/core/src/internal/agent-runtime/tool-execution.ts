import type { Agent } from "../../agent/agent";
import { parseAgentQuestionPrompts } from "../../agent/interactions/schemas";
import { type AgentLifecycle, lifecycleSnapshot } from "../../agent/lifecycle";
import type {
  JsonObject,
  ToolCallPart,
  ToolDefinition,
  ToolResultContentPart,
  ToolResultOutput,
  ToolResultPart,
} from "../../completion";
import { Usage } from "../../completion";
import { assertCompletionResponseIntegrity } from "../../completion/provider-output-error";
import type { AgentHook, ToolApprovalRequestOptions, ToolHookArgs } from "../../hooks";
import { runControl, toolCallControl } from "../../hooks";
import type { ActiveAgentRunObservers } from "../../observability/group";
import type { AgentToolStartArgs, AgentToolStreamEventArgs } from "../../observability/types";
import type {
  AnyTool,
  NormalizedToolOutput,
  ToolApprovalContext,
  ToolApprovalRunContext,
  ToolCallContext,
  ToolRequiresApproval,
} from "../../tool";
import { parseToolArgs } from "../../tool";
import type { AgentMiddleware } from "../../tool/middleware";
import { isQuestionTool } from "../../tool/question-tool";
import { isSkillTool } from "../../tool/skill-tool-marker";
import { throwIfAborted } from "../abort";
import { mapWithConcurrency } from "../concurrency";
import type { ToolApprovalRequest } from "./approval-request";
import { assertToolApprovalRequirement, toolMayRequireApproval } from "./approval-requirement";
import type { AgentRunExecution, AgentToolExecutionResult } from "./execution";
import {
  AgentInteractionSignal,
  approvalInteraction,
  type PendingToolExecution,
  ToolExecutionSuspension,
} from "./interaction-suspension";
import {
  type PreparedToolCall,
  prepareToolCall as prepareRegisteredToolCall,
  prepareToolCallFromInput,
} from "./prepared-tool-call";
import {
  runToolInputMiddlewares,
  runToolResultMiddlewares,
  sanitizeToolErrorMessage,
  toolOutputToStructuredResult,
  toolOutputToText,
} from "./tool-middleware";
import {
  type AgentToolEventPayload,
  agentToolEventPayload,
  approvalEventAttributes,
  buildToolHookArgs,
  buildToolStartArgs,
  toolErrorArgs,
  ToolObserverScope,
} from "./tool-observation";

export type { AgentToolEventPayload } from "./tool-observation";

export type ToolResultEventPayload = {
  type: "tool_result";
  toolName: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
  args: string;
  output: ToolResultOutput;
  result: string;
  structuredResult?: readonly ToolResultContentPart[] | undefined;
};

export type ToolExecutionEventPayload = ToolResultEventPayload | AgentToolEventPayload;

export type ToolExecutionObservation = {
  turn: number;
  runObservers: ActiveAgentRunObservers;
  toolDefinitions?: ToolDefinition[];
};

export type ToolExecutionRunContext = {
  runId: string;
  sessionId?: string | undefined;
  metadata?: JsonObject | undefined;
};

type ToolExecutionAgent = Pick<Agent, "id" | "getTool" | "callTool" | "middlewares">;
type ToolExecutionLifecycle = Pick<AgentLifecycle, "onToolStart" | "onToolFinish">;

type OpenedToolCall = {
  hookArgs: ToolHookArgs;
  toolStartArgs: AgentToolStartArgs;
  toolObservation: ToolObserverScope;
};

export class ToolCallExecutor {
  constructor(
    private readonly agent: ToolExecutionAgent,
    private readonly activeHook: AgentHook | undefined,
    private readonly lifecycle: ToolExecutionLifecycle | undefined,
    private readonly runContext: ToolExecutionRunContext,
    private readonly concurrency: number,
    private readonly requestMiddlewares: readonly AgentMiddleware[],
    private readonly abortSignal: AbortSignal,
    private readonly cancel: (reason: string) => Error,
    private readonly execution?: AgentRunExecution,
  ) {}

  async execute(
    toolCalls: readonly ToolCallPart[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResultPart[]> {
    assertCompletionResponseIntegrity({
      response: {
        choice: [...toolCalls],
        usage: Usage.empty(),
        rawResponse: undefined,
      },
    });

    const executeOne = async (toolCall: ToolCallPart): Promise<ToolResultPart> => {
      throwIfAborted(this.abortSignal);
      const args = JSON.stringify(toolCall.input);
      const internalCallId = globalThis.crypto.randomUUID();
      const tool = this.agent.getTool(toolCall.toolName);
      const { hookArgs, toolStartArgs, toolObservation } = await this.openToolCall(
        toolCall,
        internalCallId,
        args,
        tool,
        observation,
      );

      let output: NormalizedToolOutput | undefined;
      let skipped = false;
      let toolExecutionFailed = false;
      let effectiveArgs = args;

      try {
        const callAction = await this.activeHook?.onToolCall?.({
          ...hookArgs,
          tool: toolCallControl,
        });

        if (callAction?.type === "terminate") {
          throw this.cancel(callAction.reason);
        }

        if (callAction?.type === "skip") {
          output = { type: "text", value: callAction.reason };
          skipped = true;
        } else {
          try {
            effectiveArgs = await runToolInputMiddlewares(this.activeMiddlewares(), {
              ...hookArgs,
              turn: observation?.turn ?? 0,
              originalArgs: args,
            });
            hookArgs.args = effectiveArgs;

            let prepared: PreparedToolCall | undefined;
            try {
              prepared = this.prepareToolCall(tool, toolCall.toolName, effectiveArgs);
            } catch (error) {
              const outcome = await this.handleToolError(
                toolCall,
                hookArgs,
                effectiveArgs,
                error,
                toolObservation,
                observation,
              );
              output = outcome.output;
              toolExecutionFailed = outcome.failed;
            }

            if (prepared !== undefined && isQuestionTool(tool)) {
              try {
                const questions = parseAgentQuestionPrompts(
                  (prepared.input as { questions?: unknown }).questions,
                );
                const interaction = {
                  type: "tool-question",
                  id: globalThis.crypto.randomUUID(),
                  toolName: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  internalCallId,
                  questions,
                } as const;

                if (toolCall.callId !== undefined) {
                  Object.assign(interaction, { callId: toolCall.callId });
                }

                throw new AgentInteractionSignal(interaction);
              } catch (error) {
                if (error instanceof AgentInteractionSignal) throw error;

                const outcome = await this.handleToolError(
                  toolCall,
                  hookArgs,
                  effectiveArgs,
                  error,
                  toolObservation,
                  observation,
                );
                output = outcome.output;
                toolExecutionFailed = outcome.failed;
                prepared = undefined;
              }
            }

            if (prepared !== undefined) {
              const approvalContext = createApprovalContext(
                prepared.input,
                hookArgs,
                this.agent,
                this.runContext,
              );

              if (callAction?.type === "approval_request") {
                await this.requestApproval(approvalContext, callAction, observation);
              } else {
                await this.evaluateToolApproval(tool, approvalContext, observation);
              }

              const outcome = await this.runLifecycleToolCall(
                prepared,
                toolCall,
                hookArgs,
                effectiveArgs,
                toolObservation,
                observation,
                onStreamEvent,
              );
              output = outcome.output;
              toolExecutionFailed = outcome.failed;
            }
          } catch (error) {
            if (error instanceof AgentInteractionSignal) {
              await toolObservation.suspend({
                ...toolStartArgs,
                interaction: error.interaction,
              });
              throw error;
            }

            await toolObservation.error(
              toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
            );
            throw error;
          }
        }

        if (output === undefined) {
          throw new Error(`Tool "${toolCall.toolName}" did not produce an execution result.`);
        }

        return await this.finalizeToolOutput({
          tool,
          toolCall,
          internalCallId,
          hookArgs,
          effectiveArgs,
          output,
          skipped,
          failed: toolExecutionFailed,
          toolObservation,
          observation,
          onResult,
        });
      } catch (error) {
        if (error instanceof AgentInteractionSignal) {
          const pending: PendingToolExecution = {
            toolCall,
            effectiveArgs,
            input:
              error.interaction.type === "tool-approval"
                ? error.interaction.input
                : parseToolArgs(effectiveArgs),
            internalCallId,
          };

          if (error.rejectMessage !== undefined) pending.rejectMessage = error.rejectMessage;

          throw new ToolExecutionSuspension(error.interaction, pending);
        }

        await toolObservation.error(
          toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
        );
        throw error;
      }
    };

    if (this.concurrency === 1 || this.maySuspend(toolCalls)) {
      const results: ToolResultPart[] = [];
      for (const toolCall of toolCalls) {
        try {
          results.push(await executeOne(toolCall));
        } catch (error) {
          if (error instanceof ToolExecutionSuspension) {
            error.completedResults = [...results];
            error.remainingToolCalls = toolCalls.slice(results.length + 1);
          }

          throw error;
        }
      }
      return results;
    }

    return mapWithConcurrency(toolCalls, this.concurrency, executeOne);
  }

  async executeResumed(
    pending: PendingToolExecution,
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResultPart> {
    throwIfAborted(this.abortSignal);
    const { toolCall, internalCallId, effectiveArgs } = pending;
    const tool = this.agent.getTool(toolCall.toolName);

    if (tool === undefined) {
      throw new Error(
        `Cannot resume tool interaction because tool "${toolCall.toolName}" is no longer registered.`,
      );
    }

    if (isQuestionTool(tool)) {
      throw new TypeError("Question interactions are resolved from their submitted answers.");
    }

    const { hookArgs, toolObservation } = await this.openToolCall(
      toolCall,
      internalCallId,
      effectiveArgs,
      tool,
      observation,
    );

    try {
      const prepared = prepareToolCallFromInput(tool, pending.input);
      const outcome = await this.runLifecycleToolCall(
        prepared,
        toolCall,
        hookArgs,
        effectiveArgs,
        toolObservation,
        observation,
        onStreamEvent,
      );
      return await this.finalizeToolOutput({
        tool,
        toolCall,
        internalCallId,
        hookArgs,
        effectiveArgs,
        output: outcome.output,
        skipped: false,
        failed: outcome.failed,
        toolObservation,
        observation,
        onResult,
      });
    } catch (error) {
      await toolObservation.error(
        toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
      );
      throw error;
    }
  }

  async resolveResumed(
    pending: PendingToolExecution,
    initialOutput: NormalizedToolOutput,
    onResult?: (result: ToolResultEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResultPart> {
    throwIfAborted(this.abortSignal);
    const { toolCall, internalCallId, effectiveArgs } = pending;
    const tool = this.agent.getTool(toolCall.toolName);

    if (tool === undefined) {
      throw new Error(
        `Cannot resume tool interaction because tool "${toolCall.toolName}" is no longer registered.`,
      );
    }

    const { hookArgs, toolObservation } = await this.openToolCall(
      toolCall,
      internalCallId,
      effectiveArgs,
      tool,
      observation,
    );

    try {
      return await this.finalizeToolOutput({
        tool,
        toolCall,
        internalCallId,
        hookArgs,
        effectiveArgs,
        output: initialOutput,
        skipped: true,
        failed: false,
        toolObservation,
        observation,
        onResult,
      });
    } catch (error) {
      await toolObservation.error(
        toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
      );
      throw error;
    }
  }

  private async openToolCall(
    toolCall: ToolCallPart,
    internalCallId: string,
    args: string,
    tool: AnyTool | undefined,
    observation: ToolExecutionObservation | undefined,
  ): Promise<OpenedToolCall> {
    const hookArgs = buildToolHookArgs(toolCall, internalCallId, args);
    const toolStartArgs = buildToolStartArgs(
      observation?.turn ?? 0,
      toolCall,
      internalCallId,
      args,
      tool,
      observation?.toolDefinitions,
    );
    const replayedPending = this.replayed(toolCall);
    const replayed = typeof replayedPending === "boolean" ? replayedPending : await replayedPending;
    const observers = replayed
      ? undefined
      : await observation?.runObservers.startTool(toolStartArgs);
    return {
      hookArgs,
      toolStartArgs,
      toolObservation: new ToolObserverScope(observers),
    };
  }

  private async runLifecycleToolCall(
    prepared: PreparedToolCall,
    toolCall: ToolCallPart,
    hookArgs: ToolHookArgs,
    effectiveArgs: string,
    toolObservation: ToolObserverScope,
    observation: ToolExecutionObservation | undefined,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
  ): Promise<AgentToolExecutionResult> {
    const step = observation?.turn ?? 0;
    const lifecycleEvent = {
      runId: this.runContext.runId,
      step,
      toolName: toolCall.toolName,
      input: lifecycleSnapshot(prepared.input),
    };

    if (toolCall.callId !== undefined) {
      Object.assign(lifecycleEvent, { toolCallId: toolCall.callId });
    }

    await this.lifecycle?.onToolStart?.(lifecycleEvent);
    const startedAt = Date.now();
    const outcome = await this.runApprovedToolCall(
      prepared,
      toolCall,
      hookArgs,
      effectiveArgs,
      toolObservation,
      observation,
      onStreamEvent,
    );
    const durationMs = Date.now() - startedAt;
    await this.lifecycle?.onToolFinish?.(
      outcome.failed
        ? {
            ...lifecycleEvent,
            durationMs,
            success: false,
            error: lifecycleSnapshot(outcome.error),
          }
        : {
            ...lifecycleEvent,
            durationMs,
            success: true,
            output: lifecycleSnapshot(outcome.output),
          },
    );
    return outcome;
  }

  private async finalizeToolOutput(args: {
    tool: AnyTool | undefined;
    toolCall: ToolCallPart;
    internalCallId: string;
    hookArgs: ToolHookArgs;
    effectiveArgs: string;
    output: NormalizedToolOutput;
    skipped: boolean;
    failed: boolean;
    toolObservation: ToolObserverScope;
    observation: ToolExecutionObservation | undefined;
    onResult?: ((result: ToolResultEventPayload) => void) | undefined;
  }): Promise<ToolResultPart> {
    const turn = args.observation?.turn ?? 0;
    let output = args.output;
    let result = toolOutputToText(output);
    let structuredResult = toolOutputToStructuredResult(output);

    if (!isSkillTool(args.tool)) {
      const middlewareReplacement = await runToolResultMiddlewares(this.activeMiddlewares(), {
        ...args.hookArgs,
        args: args.effectiveArgs,
        result,
        originalResult: result,
        structuredResult,
        originalStructuredResult: structuredResult,
        turn,
      });

      if (middlewareReplacement !== undefined) {
        output = middlewareReplacement;
        result = toolOutputToText(middlewareReplacement);
        structuredResult = toolOutputToStructuredResult(middlewareReplacement);
      }
    }

    const resultAction = await this.activeHook?.onToolResult?.({
      ...args.hookArgs,
      args: args.effectiveArgs,
      result,
      structuredResult,
      run: runControl,
    });

    if (!args.failed) {
      await args.toolObservation.end({
        turn,
        toolCall: args.toolCall,
        toolName: args.toolCall.toolName,
        internalCallId: args.internalCallId,
        args: args.effectiveArgs,
        result,
        structuredResult,
        skipped: args.skipped,
        toolCallId: args.toolCall.callId,
      });
    }

    if (resultAction?.type === "terminate") {
      throw this.cancel(resultAction.reason);
    }

    const resultPayload: ToolResultEventPayload = {
      type: "tool_result",
      toolName: args.toolCall.toolName,
      toolCallId: args.toolCall.toolCallId,
      internalCallId: args.internalCallId,
      args: args.effectiveArgs,
      output,
      result,
      structuredResult,
    };

    if (args.toolCall.callId !== undefined) resultPayload.callId = args.toolCall.callId;

    args.onResult?.(resultPayload);
    let resultPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: args.toolCall.toolCallId,
      toolName: args.toolCall.toolName,
      output,
    };

    if (args.toolCall.callId !== undefined) {
      resultPart = { ...resultPart, callId: args.toolCall.callId };
    }

    return resultPart;
  }

  private maySuspend(toolCalls: readonly ToolCallPart[]): boolean {
    return toolCalls.some((toolCall) => {
      const tool = this.agent.getTool(toolCall.toolName);
      return (
        tool !== undefined &&
        (toolMayRequireApproval(tool.requiresApproval) || isQuestionTool(tool))
      );
    });
  }

  private replayed(toolCall: ToolCallPart): boolean | Promise<boolean> {
    return this.execution?.replayed?.({ kind: "tool", toolCall }) ?? false;
  }

  private runApprovedToolCall(
    prepared: PreparedToolCall,
    toolCall: ToolCallPart,
    hookArgs: ToolHookArgs,
    effectiveArgs: string,
    toolObservation: ToolObserverScope,
    observation: ToolExecutionObservation | undefined,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
  ): Promise<AgentToolExecutionResult> {
    const execute = (context?: Pick<ToolCallContext, "operationId">) =>
      this.runUncachedToolCall(
        prepared,
        toolCall,
        hookArgs,
        effectiveArgs,
        toolObservation,
        observation,
        onStreamEvent,
        context,
      );
    return this.execution === undefined
      ? execute()
      : this.execution.tool(
          { turn: observation?.turn ?? 0, toolCall, args: effectiveArgs },
          execute,
        );
  }

  private async runUncachedToolCall(
    prepared: PreparedToolCall,
    toolCall: ToolCallPart,
    hookArgs: ToolHookArgs,
    effectiveArgs: string,
    toolObservation: ToolObserverScope,
    observation: ToolExecutionObservation | undefined,
    onStreamEvent: ((event: AgentToolEventPayload) => void) | undefined,
    context: Pick<ToolCallContext, "operationId"> | undefined,
  ): Promise<AgentToolExecutionResult> {
    try {
      const toolContext: ToolCallContext = {
        ...context,
        abortSignal: this.abortSignal,
        emitStreamEvent: async (event) => {
          let streamEventArgs: AgentToolStreamEventArgs = {
            turn: observation?.turn ?? 0,
            toolCall,
            toolName: toolCall.toolName,
            internalCallId: hookArgs.internalCallId,
            args: effectiveArgs,
            event,
          };

          if (toolCall.callId !== undefined) {
            streamEventArgs = { ...streamEventArgs, toolCallId: toolCall.callId };
          }

          await toolObservation.streamEvent(streamEventArgs);
          const payload = agentToolEventPayload(toolCall, hookArgs.internalCallId, event);

          if (payload !== undefined) {
            onStreamEvent?.(payload);
          }
        },
      };
      return {
        output: await prepared.call(toolContext),
        failed: false,
      };
    } catch (error) {
      return this.handleToolError(
        toolCall,
        hookArgs,
        effectiveArgs,
        error,
        toolObservation,
        observation,
      );
    }
  }

  private prepareToolCall(
    tool: AnyTool | undefined,
    toolName: string,
    args: string,
  ): PreparedToolCall {
    if (tool !== undefined) {
      return prepareRegisteredToolCall(tool, args);
    }

    const input = parseToolArgs(args);
    return {
      input,
      call: (context) => this.agent.callTool(toolName, args, context),
    };
  }

  private async handleToolError(
    toolCall: ToolCallPart,
    hookArgs: ToolHookArgs,
    args: string,
    error: unknown,
    toolObservation: ToolObserverScope,
    observation: ToolExecutionObservation | undefined,
  ): Promise<{ output: NormalizedToolOutput; failed: true; error: unknown }> {
    const errorAction = await this.activeHook?.onToolError?.({
      ...hookArgs,
      args,
      error,
      run: runControl,
    });
    await toolObservation.error(
      toolErrorArgs(observation?.turn ?? 0, toolCall, hookArgs.internalCallId, args, error),
    );

    if (errorAction?.type === "terminate") {
      throw this.cancel(errorAction.reason);
    }

    return {
      output: {
        type: "error-text",
        value: sanitizeToolErrorMessage(error),
      },
      failed: true,
      error,
    };
  }

  private activeMiddlewares(): AgentMiddleware[] {
    return [...this.agent.middlewares, ...this.requestMiddlewares];
  }

  private async evaluateToolApproval(
    tool: AnyTool | undefined,
    context: ToolApprovalContext,
    observation: ToolExecutionObservation | undefined,
  ): Promise<void> {
    const requirement = tool?.requiresApproval as ToolRequiresApproval<unknown> | undefined;

    if (requirement === undefined) return;

    const resolved =
      typeof requirement === "function" ? await requirement(context.args, context) : requirement;
    assertToolApprovalRequirement(resolved, { allowFunction: false });

    if (resolved === false) return;

    const reason = resolved === true ? undefined : resolved.reason;
    await this.requestApproval(context, reason === undefined ? {} : { reason }, observation);
  }

  private async requestApproval(
    context: ToolApprovalContext,
    options: ToolApprovalRequestOptions,
    observation: ToolExecutionObservation | undefined,
  ): Promise<never> {
    const request: ToolApprovalRequest = {
      ...context,
      id: globalThis.crypto.randomUUID(),
    };

    if (options.reason !== undefined) {
      request.reason = options.reason;
    }

    if (options.rejectMessage !== undefined) {
      request.rejectMessage = options.rejectMessage;
    }

    await observation?.runObservers.event({
      name: "tool.approval_requested",
      attributes: approvalEventAttributes(request, observation.turn),
    });
    throw new AgentInteractionSignal(approvalInteraction(request), request.rejectMessage);
  }
}

function createApprovalContext(
  input: unknown,
  hookArgs: ToolHookArgs,
  agent: Pick<Agent, "id">,
  run: ToolExecutionRunContext,
): ToolApprovalContext {
  const approvalRun: ToolApprovalRunContext = {
    agentId: agent.id,
    runId: run.runId,
  };

  if (run.sessionId !== undefined) {
    approvalRun.sessionId = run.sessionId;
  }

  if (run.metadata !== undefined) {
    approvalRun.metadata = run.metadata;
  }

  const context: ToolApprovalContext = {
    toolName: hookArgs.toolName,
    args: lifecycleSnapshot(input),
    rawArgs: hookArgs.args,
    toolCallId: hookArgs.toolCallId,
    internalCallId: hookArgs.internalCallId,
    run: approvalRun,
  };

  if (hookArgs.callId !== undefined) {
    context.callId = hookArgs.callId;
  }

  return context;
}
