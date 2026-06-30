import { compact } from "../internal/compact";
import type {
  HookAction,
  PromptHook,
  RunControl,
  ToolApprovalRequestOptions,
  ToolCallControl,
  ToolCallHookAction,
} from "./types";

export function createHook<RawResponse = unknown>(
  hook: PromptHook<RawResponse>,
): PromptHook<RawResponse> {
  return hook;
}

export function cancelPrompt(reason: string): HookAction {
  return { type: "terminate", reason };
}

export function skipTool(reason: string): ToolCallHookAction {
  return { type: "skip", reason };
}

export function requestToolApproval(options: ToolApprovalRequestOptions = {}): ToolCallHookAction {
  return compact({
    type: "approval_request" as const,
    reason: options.reason,
    rejectMessage: options.rejectMessage,
  }) as ToolCallHookAction;
}

export const runControl: RunControl = {
  continue() {
    return { type: "continue" };
  },
  cancel(reason: string) {
    return cancelPrompt(reason);
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
