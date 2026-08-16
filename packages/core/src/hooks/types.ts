import type {
  CompletionResponse,
  Message,
  ToolResultContentPart,
  Usage,
} from "../completion/types";

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
  status: "completed";
  output: unknown;
  text: string;
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
  structuredResult?: readonly ToolResultContentPart[] | undefined;
  run: RunControl;
};

export type ToolErrorHookArgs = ToolHookArgs & {
  error: unknown;
  run: RunControl;
};

export interface AgentHook<RawResponse = unknown> {
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
