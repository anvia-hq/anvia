import type { Agent } from "../../agent/agent";
import { type AgentLifecycle, lifecycleSnapshot } from "../../agent/lifecycle";
import type { AgentApprovalDecision, AgentChildStreamEvent } from "../../agent/run-types";
import type {
  JsonObject,
  JsonValue,
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolResultContent,
} from "../../completion";
import { ToolContent } from "../../completion";
import type { AgentHook, ToolApprovalRequestOptions, ToolHookArgs } from "../../hooks";
import { runControl, toolCallControl } from "../../hooks";
import { isMcpTool } from "../../mcp";
import type { ActiveAgentRunObservers, ActiveToolObservers } from "../../observability/group";
import type {
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolStartArgs,
  AgentToolStreamEventArgs,
} from "../../observability/types";
import type {
  AnyTool,
  NormalizedToolOutput,
  ToolApprovalContext,
  ToolApprovalRunContext,
  ToolCallContext,
  ToolCallStreamEvent,
  ToolRequiresApproval,
} from "../../tool";
import { parseToolArgs, toolResultContentToText } from "../../tool";
import type {
  AgentMiddleware,
  ToolOutputMiddlewareArgs,
  ToolOutputMiddlewareResult,
} from "../../tool/middleware";
import { isSkillTool } from "../../tool/skill-tool-marker";
import { throwIfAborted } from "../abort";
import { mapWithConcurrency } from "../concurrency";
import type { ToolApprovalRequest } from "./approval-request";
import { assertToolApprovalRequirement, toolMayRequireApproval } from "./approval-requirement";
import {
  type PreparedToolCall,
  prepareToolCall as prepareRegisteredToolCall,
} from "./prepared-tool-call";

export type ToolResultEventPayload = {
  type: "tool_result";
  toolName: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
  args: string;
  result: string;
  structuredResult?: ToolResultContent[] | undefined;
};

export type AgentToolEventPayload = {
  type: "agent_tool_event";
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  agentId: string;
  agentName?: string;
  event: AgentChildStreamEvent<unknown, unknown>;
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

export type ToolApprovalHandler = (request: ToolApprovalRequest) => Promise<AgentApprovalDecision>;

type ToolExecutionAgent = Pick<Agent, "id" | "getTool" | "callTool" | "middlewares">;
type ToolExecutionLifecycle = Pick<AgentLifecycle, "onToolStart" | "onToolFinish">;

export class ToolCallExecutor {
  constructor(
    private readonly agent: ToolExecutionAgent,
    private readonly activeHook: AgentHook | undefined,
    private readonly approvalHandler: ToolApprovalHandler,
    private readonly lifecycle: ToolExecutionLifecycle | undefined,
    private readonly runContext: ToolExecutionRunContext,
    private readonly concurrency: number,
    private readonly requestMiddlewares: readonly AgentMiddleware[],
    private readonly abortSignal: AbortSignal,
    private readonly cancel: (reason: string) => Error,
  ) {}

  async execute(
    toolCalls: ToolCall[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
  ): Promise<ToolResult[]> {
    for (const toolCall of toolCalls) {
      if (toolCall.function.name.length === 0) {
        throw new Error(
          `Completion returned tool call "${toolCall.id}" with an empty function name; this indicates invalid provider output or provider mapping.`,
        );
      }
    }

    return mapWithConcurrency(toolCalls, this.concurrency, async (toolCall) => {
      throwIfAborted(this.abortSignal);
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
      const tool = this.agent.getTool(toolCall.function.name);
      const toolDefinition = observation?.toolDefinitions?.find(
        (definition) => definition.name === toolCall.function.name,
      );
      const toolMetadata = toolTraceMetadata(tool);

      const toolStartArgs: AgentToolStartArgs = {
        turn: observation?.turn ?? 0,
        toolCall,
        toolName: toolCall.function.name,
        internalCallId,
        args,
        ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
        ...(toolDefinition === undefined ? {} : { toolDefinition }),
        ...(toolMetadata === undefined ? {} : { toolMetadata }),
      };
      const toolObservers = await observation?.runObservers.startTool(toolStartArgs);
      const toolObservation = new ToolObserverScope(toolObservers);

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
          output = callAction.reason;
          skipped = true;
        } else {
          try {
            effectiveArgs = await this.runToolInputMiddlewares({
              ...hookArgs,
              turn: observation?.turn ?? 0,
              originalArgs: args,
            });
            hookArgs.args = effectiveArgs;

            let prepared: PreparedToolCall | undefined;
            try {
              prepared = this.prepareToolCall(tool, toolCall.function.name, effectiveArgs);
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
            if (prepared !== undefined) {
              const approvalContext = createApprovalContext(
                prepared.input,
                hookArgs,
                this.agent,
                this.runContext,
              );
              const approvalDecision =
                callAction?.type === "approval_request"
                  ? await this.requestApproval(approvalContext, callAction, observation)
                  : ((await this.evaluateToolApproval(tool, approvalContext, observation)) ?? {
                      approved: true as const,
                    });
              if (!approvalDecision.approved) {
                output = approvalDecision.result;
                skipped = true;
              } else {
                const step = observation?.turn ?? 0;
                const lifecycleEvent = {
                  runId: this.runContext.runId,
                  step,
                  toolName: toolCall.function.name,
                  input: lifecycleSnapshot(prepared.input),
                  ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
                };
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
                output = outcome.output;
                toolExecutionFailed = outcome.failed;
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
                        output: lifecycleSnapshot(output),
                      },
                );
              }
            }
          } catch (error) {
            await toolObservation.error(
              toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
            );
            throw error;
          }
        }

        if (output === undefined) {
          throw new Error(`Tool "${toolCall.function.name}" did not produce an execution result.`);
        }
        let result = toolOutputToText(output);
        let structuredResult = toolOutputToStructuredResult(output);
        if (!isSkillTool(tool)) {
          const middlewareReplacement = await this.runToolResultMiddlewares({
            ...hookArgs,
            args: effectiveArgs,
            result,
            originalResult: result,
            structuredResult,
            originalStructuredResult: structuredResult,
            turn: observation?.turn ?? 0,
          });
          if (middlewareReplacement !== undefined) {
            output = middlewareReplacement;
            result = toolOutputToText(middlewareReplacement);
            structuredResult = toolOutputToStructuredResult(middlewareReplacement);
          }
        }

        const resultAction = await this.activeHook?.onToolResult?.({
          ...hookArgs,
          args: effectiveArgs,
          result,
          structuredResult,
          run: runControl,
        });
        if (!toolExecutionFailed) {
          await toolObservation.end({
            turn: observation?.turn ?? 0,
            toolCall,
            toolName: toolCall.function.name,
            internalCallId,
            args: effectiveArgs,
            result,
            structuredResult,
            skipped,
            toolCallId: toolCall.callId,
          });
        }
        if (resultAction?.type === "terminate") {
          throw this.cancel(resultAction.reason);
        }

        const resultPayload: ToolResultEventPayload = {
          type: "tool_result",
          toolName: toolCall.function.name,
          toolCallId: toolCall.id,
          internalCallId,
          args: effectiveArgs,
          result,
          structuredResult,
          ...(toolCall.callId === undefined ? {} : { callId: toolCall.callId }),
        };
        onResult?.(resultPayload);
        return ToolContent.toolResult(toolCall.id, output, {
          callId: toolCall.callId,
          toolName: toolCall.function.name,
        });
      } catch (error) {
        await toolObservation.error(
          toolErrorArgs(observation?.turn ?? 0, toolCall, internalCallId, effectiveArgs, error),
        );
        throw error;
      }
    });
  }

  private async runApprovedToolCall(
    prepared: PreparedToolCall,
    toolCall: ToolCall,
    hookArgs: ToolHookArgs,
    effectiveArgs: string,
    toolObservation: ToolObserverScope,
    observation: ToolExecutionObservation | undefined,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
  ): Promise<
    | { output: NormalizedToolOutput; failed: false }
    | { output: NormalizedToolOutput; failed: true; error: unknown }
  > {
    try {
      const toolContext: ToolCallContext = {
        abortSignal: this.abortSignal,
        emitStreamEvent: async (event) => {
          const streamEventArgs: AgentToolStreamEventArgs = {
            turn: observation?.turn ?? 0,
            toolCall,
            toolName: toolCall.function.name,
            internalCallId: hookArgs.internalCallId,
            args: effectiveArgs,
            event,
            ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
          };
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
    toolCall: ToolCall,
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
      output: error instanceof Error ? error.toString() : String(error),
      failed: true,
      error,
    };
  }

  private async runToolResultMiddlewares(
    args: ToolOutputMiddlewareArgs,
  ): Promise<NormalizedToolOutput | undefined> {
    let result = args.result;
    let structuredResult = args.structuredResult;
    let replaced = false;
    for (const middleware of this.activeMiddlewares()) {
      const outputReplacement = await middleware.onToolOutput?.({
        ...args,
        result,
        structuredResult,
      });
      if (outputReplacement !== undefined) {
        const normalized = normalizeToolOutputMiddlewareResult(outputReplacement);
        if (normalized.result !== undefined) {
          result = normalized.result;
          structuredResult = undefined;
        }
        if (normalized.structuredResult !== undefined) {
          structuredResult = normalized.structuredResult;
          result = toolResultContentToText(normalized.structuredResult);
        }
        replaced = true;
      }
    }
    return replaced ? (structuredResult ?? result) : undefined;
  }

  private async runToolInputMiddlewares(
    args: ToolHookArgs & { turn: number; originalArgs: string },
  ): Promise<string> {
    let current = args.args;
    for (const middleware of this.activeMiddlewares()) {
      const replacement = await middleware.onToolInput?.({
        ...args,
        args: current,
      });
      if (replacement?.args !== undefined) {
        current =
          typeof replacement.args === "string"
            ? replacement.args
            : JSON.stringify(replacement.args);
      }
    }
    return current;
  }

  private activeMiddlewares(): AgentMiddleware[] {
    return [...this.agent.middlewares, ...this.requestMiddlewares];
  }

  private async evaluateToolApproval(
    tool: AnyTool | undefined,
    context: ToolApprovalContext,
    observation: ToolExecutionObservation | undefined,
  ): Promise<{ approved: true } | { approved: false; result: string } | undefined> {
    const requirement = tool?.requiresApproval as ToolRequiresApproval<unknown> | undefined;
    if (requirement === undefined) return undefined;
    const resolved =
      typeof requirement === "function" ? await requirement(context.args, context) : requirement;
    assertToolApprovalRequirement(resolved, { allowFunction: false });
    if (resolved === false) return { approved: true };
    const reason = resolved === true ? undefined : resolved.reason;
    return this.requestApproval(context, reason === undefined ? {} : { reason }, observation);
  }

  private async requestApproval(
    context: ToolApprovalContext,
    options: ToolApprovalRequestOptions,
    observation: ToolExecutionObservation | undefined,
  ): Promise<{ approved: true } | { approved: false; result: string }> {
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
    let decision: AgentApprovalDecision;
    try {
      decision = await this.approvalHandler(request);
    } catch (error) {
      await observation?.runObservers.event({
        name: "tool.approval_failed",
        level: "ERROR",
        attributes: {
          ...approvalEventAttributes(request, observation.turn),
          errorName: error instanceof Error ? error.name : typeof error,
        },
      });
      throw error;
    }
    await observation?.runObservers.event({
      name: "tool.approval_resolved",
      attributes: {
        ...approvalEventAttributes(request, observation.turn),
        approved: decision.approved,
        ...(decision.reason === undefined ? {} : { decisionReason: decision.reason }),
      },
    });
    if (decision.approved) {
      return { approved: true };
    }
    return {
      approved: false,
      result: decision.reason ?? request.rejectMessage ?? "Tool approval was rejected.",
    };
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
    internalCallId: hookArgs.internalCallId,
    run: approvalRun,
  };
  if (hookArgs.toolCallId !== undefined) {
    context.toolCallId = hookArgs.toolCallId;
  }
  return context;
}

function approvalEventAttributes(
  request: ToolApprovalRequest,
  turn: number,
): Record<string, JsonValue | undefined> {
  return {
    turn,
    approvalId: request.id,
    toolName: request.toolName,
    toolCallId: request.toolCallId,
    internalCallId: request.internalCallId,
    reason: request.reason,
  };
}

function normalizeToolOutputMiddlewareResult(result: ToolOutputMiddlewareResult): {
  result?: string | undefined;
  structuredResult?: ToolResultContent[] | undefined;
} {
  if (typeof result === "string") {
    return { result };
  }
  return result ?? {};
}

function toolTraceMetadata(tool: AnyTool | undefined): JsonObject | undefined {
  if (tool === undefined) {
    return undefined;
  }
  const result: JsonObject = {
    approvalRequired: toolMayRequireApproval(tool.requiresApproval),
  };
  if (isMcpTool(tool)) {
    result.mcpServerName = tool.mcp.serverName;
    result.mcpRemoteName = tool.mcp.remoteName;
  }
  return result;
}

function toolErrorArgs(
  turn: number,
  toolCall: ToolCall,
  internalCallId: string,
  args: string,
  error: unknown,
): AgentToolErrorArgs {
  const observerArgs: AgentToolErrorArgs = {
    turn,
    toolCall,
    toolName: toolCall.function.name,
    internalCallId,
    args,
    error,
    ...(toolCall.callId === undefined ? {} : { toolCallId: toolCall.callId }),
  };
  return observerArgs;
}

class ToolObserverScope {
  private terminal = false;

  constructor(private readonly observers: ActiveToolObservers | undefined) {}

  streamEvent(args: AgentToolStreamEventArgs): Promise<void> | undefined {
    return this.observers?.streamEvent(args);
  }

  async end(args: AgentToolEndArgs): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    await this.observers?.end(args);
  }

  async error(args: AgentToolErrorArgs): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    await this.observers?.error(args);
  }
}

function toolOutputToText(output: NormalizedToolOutput): string {
  return typeof output === "string" ? output : toolResultContentToText(output);
}

function toolOutputToStructuredResult(
  output: NormalizedToolOutput,
): ToolResultContent[] | undefined {
  return typeof output === "string" ? undefined : output;
}

function agentToolEventPayload(
  toolCall: ToolCall,
  internalCallId: string,
  event: ToolCallStreamEvent,
): AgentToolEventPayload | undefined {
  if (typeof event.agentId !== "string" || event.agentId.length === 0) {
    return undefined;
  }
  const payload: AgentToolEventPayload = {
    type: "agent_tool_event" as const,
    toolName: toolCall.function.name,
    internalCallId,
    agentId: event.agentId,
    event: event.event as AgentChildStreamEvent<unknown, unknown>,
  };
  if (toolCall.callId !== undefined) {
    payload.toolCallId = toolCall.callId;
  }
  if (event.agentName !== undefined) {
    payload.agentName = event.agentName;
  }
  return payload;
}
