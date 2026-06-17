import type { CompletionResponse, Message, ToolResultContent, Usage } from "../completion/index";
import { compact } from "../internal/compact";

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

export type RunStartHookArgs = {
  prompt: Message;
  history: Message[];
  maxTurns: number;
  run: RunControl;
};

export type RunEndHookArgs = {
  output: string;
  usage: Usage;
  messages: Message[];
  run: RunControl;
};

export type RunErrorHookArgs = {
  error: unknown;
  usage: Usage;
  messages: Message[];
  run: RunControl;
};

export type TurnStartHookArgs = {
  turn: number;
  prompt: Message;
  history: Message[];
  run: RunControl;
};

export type TurnEndHookArgs<RawResponse = unknown> = {
  turn: number;
  response: CompletionResponse<RawResponse>;
  run: RunControl;
};

export type CompletionResponseHookArgs<RawResponse = unknown> = {
  prompt: Message;
  response: CompletionResponse<RawResponse>;
  run: RunControl;
};

export type CompletionErrorHookArgs = {
  prompt: Message;
  error: unknown;
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
  structuredResult?: ToolResultContent[] | undefined;
  run: RunControl;
};

export type ToolErrorHookArgs = ToolHookArgs & {
  error: unknown;
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

export interface PromptHook<RawResponse = unknown> {
  onRunStart?: HookCallback<RunStartHookArgs>;
  onRunEnd?: HookCallback<RunEndHookArgs>;
  onRunError?: HookCallback<RunErrorHookArgs>;
  onTurnStart?: HookCallback<TurnStartHookArgs>;
  onTurnEnd?: HookCallback<TurnEndHookArgs<RawResponse>>;
  onCompletionCall?: HookCallback<CompletionCallHookArgs>;
  onCompletionResponse?: HookCallback<CompletionResponseHookArgs<RawResponse>>;
  onCompletionError?: HookCallback<CompletionErrorHookArgs>;
  onToolCall?: ToolCallHookCallback<ToolCallHookArgs>;
  onToolResult?: HookCallback<ToolResultHookArgs>;
  onToolError?: HookCallback<ToolErrorHookArgs>;
}
