import type {
  AgentHook,
  HookAction,
  RunControl,
  ToolApprovalRequestOptions,
  ToolCallControl,
  ToolCallHookAction,
} from "./types";

export function createHook<RawResponse = unknown>(
  hook: AgentHook<RawResponse>,
): AgentHook<RawResponse> {
  return hook;
}

export function cancelRun(reason: string): HookAction {
  return { type: "terminate", reason };
}

export function skipTool(reason: string): ToolCallHookAction {
  return { type: "skip", reason };
}

export function requestToolApproval(options: ToolApprovalRequestOptions = {}): ToolCallHookAction {
  const action: ToolCallHookAction = {
    type: "approval_request" as const,
  };
  if (options.reason !== undefined) {
    action.reason = options.reason;
  }
  if (options.rejectMessage !== undefined) {
    action.rejectMessage = options.rejectMessage;
  }
  return action;
}

export const runControl: RunControl = {
  continue() {
    return { type: "continue" };
  },
  cancel(reason: string) {
    return cancelRun(reason);
  },
};

export const toolCallControl: ToolCallControl = {
  run() {
    return { type: "continue" };
  },
  skip(reason: string) {
    return skipTool(reason);
  },
  cancel(reason: string) {
    return { type: "terminate", reason };
  },
  requestApproval(options) {
    return requestToolApproval(options);
  },
};
