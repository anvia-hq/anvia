import {
  type AgentHook,
  createHook,
  type HookAction,
  type ToolCallHookAction,
} from "@anvia/core/hooks";
import {
  type Agent,
  createResolvedAgent,
  getResolvedAgentOptions,
  type ResolvedAgentOptions,
} from "@anvia/core/internal/agent";

export function cloneAgent(agent: Agent, overrides: Partial<ResolvedAgentOptions> = {}): Agent {
  return createResolvedAgent({
    ...getResolvedAgentOptions(agent),
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
