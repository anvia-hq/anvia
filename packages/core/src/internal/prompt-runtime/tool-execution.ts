import type { Agent } from "../../agent/agent";
import type {
  JsonObject,
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolResultContent,
} from "../../completion";
import { ToolContent } from "../../completion";
import {
  type GuardrailDecisionRecord,
  type GuardrailPolicy,
  type GuardrailRunContext,
  runToolGuardrails,
  runToolResultGuardrails,
  type ToolGuardrail,
  type ToolGuardrailContext,
  type ToolResultGuardrail,
  type ToolResultGuardrailContext,
} from "../../guardrails";
import type { PromptHook, ToolApprovalRequestOptions, ToolHookArgs } from "../../hooks";
import { runControl, toolCallControl } from "../../hooks";
import type { ActiveAgentRunObservers, ActiveToolObservers } from "../../observability/group";
import { ToolApprovalRequiredError } from "../../request/errors";
import type { AgentChildStreamEvent } from "../../request/types";
import type {
  AnyTool,
  NormalizedToolOutput,
  ToolApprovalContext,
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalRequest,
  ToolApprovalsOptions,
  ToolCallStreamEvent,
} from "../../tool";
import { parseToolArgs, toolResultContentToText } from "../../tool";
import type {
  AgentMiddleware,
  ToolOutputMiddlewareArgs,
  ToolOutputMiddlewareResult,
} from "../../tool/middleware";
import { compact } from "../compact";
import { mapWithConcurrency } from "../concurrency";

const MCP_TOOL_METADATA_KEY = Symbol.for("anvia.mcp.tool.metadata");

export type ToolResultEventPayload = {
  type: "tool_result";
  toolName: string;
  toolCallId?: string;
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
  event: AgentChildStreamEvent;
};

export type GuardrailDecisionEventPayload = {
  type: "guardrail_decision";
  decision: GuardrailDecisionRecord;
};

export type ToolExecutionEventPayload =
  | ToolResultEventPayload
  | AgentToolEventPayload
  | GuardrailDecisionEventPayload;

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

export class ToolCallExecutor {
  constructor(
    private readonly agent: Agent,
    private readonly activeHook: PromptHook | undefined,
    private readonly approvals: ToolApprovalsOptions | undefined,
    private readonly guardrails: GuardrailPolicy[],
    private readonly runContext: ToolExecutionRunContext,
    private readonly concurrency: number,
    private readonly requestMiddlewares: AgentMiddleware[],
    private readonly cancel: (reason: string) => Error,
    private readonly onGuardrailDecision:
      | ((decision: GuardrailDecisionRecord) => void | Promise<void>)
      | undefined,
  ) {}

  async execute(
    toolCalls: ToolCall[],
    onResult?: (result: ToolResultEventPayload) => void,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    observation?: ToolExecutionObservation,
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
      const tool = this.agent.getTool(toolCall.function.name);
      const toolDefinition = observation?.toolDefinitions?.find(
        (definition) => definition.name === toolCall.function.name,
      );
      const toolMetadata = toolTraceMetadata(tool);

      const toolObservers = await observation?.runObservers.startTool(
        compact({
          turn: observation.turn,
          toolCall,
          toolName: toolCall.function.name,
          internalCallId,
          args,
          toolCallId: toolCall.callId,
          toolDefinition,
          toolMetadata,
        }),
      );

      let output: NormalizedToolOutput;
      let skipped = false;
      let effectiveArgs = args;

      const callAction = await this.activeHook?.onToolCall?.({
        ...hookArgs,
        tool: toolCallControl,
      });
      if (callAction?.type === "terminate") {
        await recordToolError(
          toolObservers,
          observation?.turn,
          toolCall,
          internalCallId,
          effectiveArgs,
          callAction.reason,
        );
        throw this.cancel(callAction.reason);
      }
      if (callAction?.type === "skip") {
        output = callAction.reason;
        skipped = true;
      } else {
        let approvalDecision: { approved: true } | { approved: false; result: string };
        try {
          effectiveArgs = await this.runToolInputMiddlewares({
            ...hookArgs,
            turn: observation?.turn ?? 0,
            originalArgs: args,
          });
          hookArgs.args = effectiveArgs;

          const inputGuardrailResult = await runToolGuardrails(
            this.guardrails,
            (tool?.inputGuardrails ?? []) as ToolGuardrail[],
            toolGuardrailContext(
              tool,
              hookArgs,
              this.agent,
              this.runContext,
              observation?.turn ?? 0,
            ),
          );
          await this.recordGuardrailDecisions(inputGuardrailResult.decisions);
          effectiveArgs = inputGuardrailResult.rawArgs;
          hookArgs.args = effectiveArgs;

          if (inputGuardrailResult.blocked) {
            output = inputGuardrailResult.message ?? "Tool call blocked by guardrail.";
            skipped = true;
          } else {
            approvalDecision =
              inputGuardrailResult.approval !== undefined
                ? await this.requestApproval(
                    tool,
                    hookArgs,
                    compact({
                      reason: inputGuardrailResult.approval.reason,
                      rejectMessage: inputGuardrailResult.approval.rejectMessage,
                    }),
                  )
                : callAction?.type === "approval_request"
                  ? await this.requestApproval(tool, hookArgs, callAction)
                  : ((await this.evaluateToolApproval(tool, hookArgs)) ?? { approved: true });
            if (!approvalDecision.approved) {
              output = approvalDecision.result;
              skipped = true;
            } else {
              output = await this.runApprovedToolCall(
                toolCall,
                hookArgs,
                effectiveArgs,
                args,
                toolObservers,
                observation,
                onStreamEvent,
                false,
              );
              effectiveArgs = hookArgs.args;
            }
          }
        } catch (error) {
          await recordToolError(
            toolObservers,
            observation?.turn,
            toolCall,
            internalCallId,
            effectiveArgs,
            error,
          );
          throw error;
        }
      }

      let result = toolOutputToText(output);
      let structuredResult = toolOutputToStructuredResult(output);
      if (this.agent.shouldApplyToolMiddleware(toolCall.function.name)) {
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

      const resultGuardrailResult = await runToolResultGuardrails(
        this.guardrails,
        (tool?.outputGuardrails ?? []) as ToolResultGuardrail[],
        toolResultGuardrailContext(
          tool,
          hookArgs,
          result,
          structuredResult,
          this.agent,
          this.runContext,
          observation?.turn ?? 0,
        ),
      );
      await this.recordGuardrailDecisions(resultGuardrailResult.decisions);
      if (resultGuardrailResult.blocked) {
        output = resultGuardrailResult.message ?? "Tool result blocked by guardrail.";
        result = toolOutputToText(output);
        structuredResult = toolOutputToStructuredResult(output);
      } else if (
        resultGuardrailResult.result !== result ||
        resultGuardrailResult.structuredResult !== structuredResult
      ) {
        output = resultGuardrailResult.structuredResult ?? resultGuardrailResult.result;
        result = resultGuardrailResult.result;
        structuredResult = resultGuardrailResult.structuredResult;
      }

      const resultAction = await this.activeHook?.onToolResult?.({
        ...hookArgs,
        args: effectiveArgs,
        result,
        structuredResult,
        run: runControl,
      });
      await toolObservers?.end({
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
      if (resultAction?.type === "terminate") {
        throw this.cancel(resultAction.reason);
      }

      const resultPayload: ToolResultEventPayload = {
        type: "tool_result",
        toolName: toolCall.function.name,
        internalCallId,
        args: effectiveArgs,
        result,
        structuredResult,
      };
      if (toolCall.callId !== undefined) {
        resultPayload.toolCallId = toolCall.callId;
      }
      onResult?.(resultPayload);
      return ToolContent.toolResult(toolCall.id, output, toolCall.callId);
    });
  }

  private async runApprovedToolCall(
    toolCall: ToolCall,
    hookArgs: ToolHookArgs,
    effectiveArgs: string,
    originalArgs: string,
    toolObservers: ActiveToolObservers | undefined,
    observation: ToolExecutionObservation | undefined,
    onStreamEvent?: (event: AgentToolEventPayload) => void,
    applyInputMiddleware = true,
  ): Promise<NormalizedToolOutput> {
    const middlewareArgs = applyInputMiddleware
      ? await this.runToolInputMiddlewares({
          ...hookArgs,
          args: effectiveArgs,
          turn: observation?.turn ?? 0,
          originalArgs,
        })
      : effectiveArgs;
    hookArgs.args = middlewareArgs;
    try {
      return await this.agent.callTool(toolCall.function.name, middlewareArgs, {
        emitStreamEvent: async (event) => {
          await toolObservers?.streamEvent(
            compact({
              turn: observation?.turn ?? 0,
              toolCall,
              toolName: toolCall.function.name,
              internalCallId: hookArgs.internalCallId,
              args: middlewareArgs,
              toolCallId: toolCall.callId,
              event,
            }),
          );
          const payload = agentToolEventPayload(toolCall, hookArgs.internalCallId, event);
          if (payload !== undefined) {
            onStreamEvent?.(payload);
          }
        },
      });
    } catch (error) {
      const errorAction = await this.activeHook?.onToolError?.({
        ...hookArgs,
        args: middlewareArgs,
        error,
        run: runControl,
      });
      await toolObservers?.error({
        turn: observation?.turn ?? 0,
        toolCall,
        toolName: toolCall.function.name,
        internalCallId: hookArgs.internalCallId,
        args: middlewareArgs,
        ...(toolCall.callId !== undefined && { toolCallId: toolCall.callId }),
        error,
      });
      if (errorAction?.type === "terminate") {
        throw this.cancel(errorAction.reason);
      }
      return error instanceof Error ? error.toString() : String(error);
    }
  }

  private async recordGuardrailDecisions(decisions: GuardrailDecisionRecord[]): Promise<void> {
    for (const decision of decisions) {
      await this.onGuardrailDecision?.(decision);
    }
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
      const legacyReplacement = await middleware.onResult?.({
        ...args,
        result,
        structuredResult,
      });
      if (legacyReplacement !== undefined) {
        result = legacyReplacement;
        structuredResult = undefined;
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
    hookArgs: ToolHookArgs,
  ): Promise<{ approved: true } | { approved: false; result: string } | undefined> {
    if (tool?.approval === undefined) {
      return undefined;
    }
    const policy = tool.approval as ToolApprovalPolicy<unknown>;
    const context = approvalContext(tool, hookArgs, this.agent, this.runContext);
    const required = await policy.when(context);
    if (!required) {
      return { approved: true };
    }

    const reason = await resolveApprovalText(policy.reason, context);
    const rejectMessage = await resolveApprovalText(policy.rejectMessage, context);
    return this.requestApproval(tool, hookArgs, compact({ reason, rejectMessage }));
  }

  private async requestApproval(
    tool: AnyTool | undefined,
    hookArgs: ToolHookArgs,
    options: ToolApprovalRequestOptions,
  ): Promise<{ approved: true } | { approved: false; result: string }> {
    const request = compact({
      ...approvalContext(tool, hookArgs, this.agent, this.runContext),
      reason: options.reason,
      rejectMessage: options.rejectMessage,
    }) as ToolApprovalRequest;
    if (this.approvals === undefined) {
      throw new ToolApprovalRequiredError(request);
    }

    const decision = normalizeApprovalDecision(await this.approvals.handler(request));
    if (decision.approved) {
      return { approved: true };
    }
    return {
      approved: false,
      result:
        decision.rejectMessage ??
        decision.reason ??
        request.rejectMessage ??
        "Tool approval was rejected.",
    };
  }
}

function approvalContext(
  tool: AnyTool | undefined,
  hookArgs: ToolHookArgs,
  agent: Agent,
  run: ToolExecutionRunContext,
): ToolApprovalContext {
  const rawParsedArgs = parseToolArgs(hookArgs.args);
  const parsedArgs = tool?.parseApprovalArgs?.(rawParsedArgs) ?? rawParsedArgs;
  return compact({
    toolName: hookArgs.toolName,
    args: parsedArgs,
    rawArgs: hookArgs.args,
    toolCallId: hookArgs.toolCallId,
    internalCallId: hookArgs.internalCallId,
    run: compact({
      agentId: agent.id,
      runId: run.runId,
      sessionId: run.sessionId,
      metadata: run.metadata,
    }),
  }) as ToolApprovalContext;
}

function toolGuardrailContext(
  tool: AnyTool | undefined,
  hookArgs: ToolHookArgs,
  agent: Agent,
  run: ToolExecutionRunContext,
  turn: number,
): ToolGuardrailContext {
  const parsedArgs = parseGuardrailContextArgs(tool, hookArgs.args);
  return compact({
    toolName: hookArgs.toolName,
    args: parsedArgs,
    rawArgs: hookArgs.args,
    toolCallId: hookArgs.toolCallId,
    internalCallId: hookArgs.internalCallId,
    turn,
    run: guardrailRunContext(agent, run),
  }) as ToolGuardrailContext;
}

function toolResultGuardrailContext(
  tool: AnyTool | undefined,
  hookArgs: ToolHookArgs,
  result: string,
  structuredResult: ToolResultContent[] | undefined,
  agent: Agent,
  run: ToolExecutionRunContext,
  turn: number,
): ToolResultGuardrailContext {
  const parsedArgs = parseGuardrailContextArgs(tool, hookArgs.args);
  return compact({
    toolName: hookArgs.toolName,
    args: parsedArgs,
    rawArgs: hookArgs.args,
    result,
    structuredResult,
    toolCallId: hookArgs.toolCallId,
    internalCallId: hookArgs.internalCallId,
    turn,
    run: guardrailRunContext(agent, run),
  }) as ToolResultGuardrailContext;
}

function parseGuardrailContextArgs(tool: AnyTool | undefined, rawArgs: string): unknown {
  const parsedArgs = parseGuardrailArgs(rawArgs);
  try {
    return tool?.parseApprovalArgs?.(parsedArgs) ?? parsedArgs;
  } catch {
    return parsedArgs;
  }
}

function parseGuardrailArgs(args: string): unknown {
  try {
    return parseToolArgs(args);
  } catch {
    return args;
  }
}

function guardrailRunContext(agent: Agent, run: ToolExecutionRunContext): GuardrailRunContext {
  return compact({
    agentId: agent.id,
    runId: run.runId,
    sessionId: run.sessionId,
    metadata: run.metadata,
  }) as GuardrailRunContext;
}

function normalizeApprovalDecision(decision: ToolApprovalDecision): {
  approved: boolean;
  reason?: string;
  rejectMessage?: string;
} {
  if (typeof decision === "boolean") {
    return { approved: decision };
  }
  return decision;
}

async function resolveApprovalText<Args>(
  value: string | ((ctx: ToolApprovalContext<Args>) => string | Promise<string>) | undefined,
  context: ToolApprovalContext<Args>,
): Promise<string | undefined> {
  return typeof value === "function" ? value(context as ToolApprovalContext<Args>) : value;
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
  const metadata = (tool as { [MCP_TOOL_METADATA_KEY]?: unknown })[MCP_TOOL_METADATA_KEY];
  const mcpMetadata =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { serverName?: unknown })
      : undefined;
  return {
    approvalRequired: tool.approval !== undefined,
    inputGuardrailCount: tool.inputGuardrails?.length ?? 0,
    outputGuardrailCount: tool.outputGuardrails?.length ?? 0,
    ...(typeof mcpMetadata?.serverName === "string" && mcpMetadata.serverName.length > 0
      ? { mcpServerName: mcpMetadata.serverName }
      : {}),
  };
}

async function recordToolError(
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
  return compact({
    type: "agent_tool_event" as const,
    toolName: toolCall.function.name,
    toolCallId: toolCall.callId,
    internalCallId,
    agentId: event.agentId,
    agentName: event.agentName,
    event: event.event as AgentChildStreamEvent,
  });
}
