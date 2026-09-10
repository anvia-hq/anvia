import type {
  CompletionResponse,
  Message,
  ToolResultContentPart,
  Usage,
} from "../completion/types";

/**
 * Outcome requested by a run-lifecycle hook: keep going, or terminate the run
 * with a reason.
 */
export type HookAction = { type: "continue" } | { type: "terminate"; reason: string };

export type ToolApprovalRequestOptions = {
  /** Human-facing reason attached to the approval request. */
  reason?: string;
  /** Message returned to the model when the approval is denied. */
  rejectMessage?: string;
};

/**
 * Outcome requested by a tool-call hook:
 *
 * - `continue`: execute the tool
 * - `skip`: bypass this call and tell the model why
 * - `terminate`: end the run
 * - `approval_request`: suspend the call until a human approves or denies it
 */
export type ToolCallHookAction =
  | { type: "continue" }
  | { type: "skip"; reason: string }
  | { type: "terminate"; reason: string }
  | ({ type: "approval_request" } & ToolApprovalRequestOptions);

/** Control surface for run-lifecycle hooks. */
export type RunControl = {
  continue(): HookAction;
  cancel(reason: string): HookAction;
};

/** Control surface for tool-call hooks; each method returns the matching action. */
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

/** Arguments for the hook invoked before a completion request leaves the runtime. */
export type CompletionCallHookArgs = {
  prompt: Message;
  history: Message[];
  run: RunControl;
};

/** Arguments for the hook invoked when a run starts. */
export type RunStartHookArgs = {
  prompt: Message;
  history: Message[];
  maxTurns: number;
  run: RunControl;
};

/** Arguments for the hook invoked after a run completes successfully. */
export type RunEndHookArgs = {
  status: "completed";
  output: unknown;
  text: string;
  usage: Usage;
  messages: Message[];
  run: RunControl;
};

/** Arguments for the hook invoked when a run fails. */
export type RunErrorHookArgs = {
  error: unknown;
  usage: Usage;
  messages: Message[];
  run: RunControl;
};

/** Arguments for the hooks around each agent turn. */
export type TurnStartHookArgs = {
  turn: number;
  prompt: Message;
  history: Message[];
  run: RunControl;
};

/** Arguments for the hook invoked after each agent turn completes. */
export type TurnEndHookArgs<RawResponse = unknown> = {
  turn: number;
  response: CompletionResponse<RawResponse>;
  run: RunControl;
};

/** Arguments for the hook invoked when a raw provider response arrives. */
export type CompletionResponseHookArgs<RawResponse = unknown> = {
  prompt: Message;
  response: CompletionResponse<RawResponse>;
  run: RunControl;
};

/** Arguments for the hook invoked when a completion request fails. */
export type CompletionErrorHookArgs = {
  prompt: Message;
  error: unknown;
  run: RunControl;
};

/** Common fields identifying the tool call a hook fired for. */
export type ToolHookArgs = {
  toolName: string;
  toolCallId: string;
  callId?: string;
  internalCallId: string;
  args: string;
};

/** Arguments for the hook invoked before a tool executes; can steer or block the call. */
export type ToolCallHookArgs = ToolHookArgs & {
  tool: ToolCallControl;
};

/** Arguments for the hook invoked after a tool produces a result. */
export type ToolResultHookArgs = ToolHookArgs & {
  result: string;
  structuredResult?: readonly ToolResultContentPart[] | undefined;
  run: RunControl;
};

/** Arguments for the hook invoked when a tool execution fails. */
export type ToolErrorHookArgs = ToolHookArgs & {
  error: unknown;
  run: RunControl;
};

/**
 * Lifecycle hooks observing an agent run. Every hook is optional; returning an
 * action (see {@link HookAction} / {@link ToolCallHookAction}) steers or stops
 * the run, while returning nothing simply observes.
 */
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
