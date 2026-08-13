import {
  type AgentHook,
  createHook,
  type HookAction,
  type ToolCallHookAction,
} from "@anvia/core/hooks";
import {
  type Agent,
  createResolvedAgent,
  type ResolvedAgentOptions,
} from "@anvia/core/internal/agent";

export function cloneAgent(agent: Agent, overrides: Partial<ResolvedAgentOptions> = {}): Agent {
  return createResolvedAgent({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    instructions: agent.instructions,
    staticContext: agent.staticContext,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    additionalParams: agent.additionalParams,
    toolSet: agent.toolSet,
    toolChoice: agent.toolChoice,
    defaultMaxTurns: agent.defaultMaxTurns,
    hook: agent.hook,
    outputSchema: agent.outputSchema,
    observers: agent.observers,
    approvals: agent.approvals,
    dynamicContexts: agent.dynamicContexts,
    dynamicTools: agent.dynamicTools,
    middlewares: agent.middlewares,
    memory: agent.memory,
    ...overrides,
  });
}

export function composeHooks(
  first: AgentHook | undefined,
  second: AgentHook | undefined,
): AgentHook | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }

  return createHook({
    async onCompletionCall(args): Promise<HookAction | undefined> {
      const firstAction = await first.onCompletionCall?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onCompletionCall?.(args)) ?? undefined);
    },
    async onCompletionResponse(args): Promise<HookAction | undefined> {
      const firstAction = await first.onCompletionResponse?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onCompletionResponse?.(args)) ?? undefined);
    },
    async onToolCall(args): Promise<ToolCallHookAction | undefined> {
      const firstAction = await first.onToolCall?.(args);
      if (
        firstAction?.type === "skip" ||
        firstAction?.type === "terminate" ||
        firstAction?.type === "approval_request"
      ) {
        return firstAction;
      }
      const secondAction = await second.onToolCall?.(args);
      return secondAction ?? firstAction ?? undefined;
    },
    async onToolResult(args): Promise<HookAction | undefined> {
      const firstAction = await first.onToolResult?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onToolResult?.(args)) ?? undefined);
    },
  });
}
