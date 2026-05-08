import type { CompletionResponse, Message } from "../completion/index";

export type HookAction = { type: "continue" } | { type: "terminate"; reason: string };
export type ToolApprovalRequestOptions = {
  reason?: string;
  rejectMessage?: string;
};

export type ToolCallHookAction =
  | { type: "continue" }
  | { type: "skip"; reason: string }
  | { type: "terminate"; reason: string }
  | ({ type: "approval_request" } & ToolApprovalRequestOptions);

export type RunControl = {
  continue(): HookAction;
  cancel(reason: string): HookAction;
};

export type ToolCallControl = {
  run(): ToolCallHookAction;
  skip(reason: string): ToolCallHookAction;
  cancel(reason: string): ToolCallHookAction;
  requestApproval(options?: ToolApprovalRequestOptions): ToolCallHookAction;
};

export type HookResult = HookAction | undefined;
export type ToolCallHookResult = ToolCallHookAction | undefined;

type HookCallback<Args> = (
  args: Args,
) => HookAction | Promise<HookAction | undefined> | Promise<void> | void;
type ToolCallHookCallback<Args> = (
  args: Args,
) => ToolCallHookAction | Promise<ToolCallHookAction | undefined> | Promise<void> | void;

export type CompletionCallHookArgs = {
  prompt: Message;
  history: Message[];
  run: RunControl;
};

export type CompletionResponseHookArgs<RawResponse = unknown> = {
  prompt: Message;
  response: CompletionResponse<RawResponse>;
  run: RunControl;
};

export type ToolHookArgs = {
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  args: string;
};

export type ToolCallHookArgs = ToolHookArgs & {
  tool: ToolCallControl;
};

export type ToolResultHookArgs = ToolHookArgs & {
  result: string;
  run: RunControl;
};

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
  return {
    type: "approval_request",
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.rejectMessage === undefined ? {} : { rejectMessage: options.rejectMessage }),
  };
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

export interface PromptHook<RawResponse = unknown> {
  onCompletionCall?: HookCallback<CompletionCallHookArgs>;
  onCompletionResponse?: HookCallback<CompletionResponseHookArgs<RawResponse>>;
  onToolCall?: ToolCallHookCallback<ToolCallHookArgs>;
  onToolResult?: HookCallback<ToolResultHookArgs>;
}
