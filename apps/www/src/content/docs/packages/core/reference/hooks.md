---
title: "Hooks"
description: "Prompt lifecycle hooks, hook controls, and hook helper functions."
section: packages
sidebar:
  group: "Reference"
  order: 3
  label: "Hooks"
---
Import from `@anvia/core/hooks` when a reusable package needs hook contracts without importing agent construction or tool APIs. Application code can also import these symbols from `@anvia/core`.

## PromptHook

```ts
interface PromptHook<RawResponse = unknown> {
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
```

Purpose: intercept run lifecycle, turn lifecycle, completion calls, completion responses, completion errors, tool calls, tool results, and tool errors.

Return behavior: hook callbacks may continue, cancel, skip a tool, or request tool approval depending on the hook phase.

## Controls

```ts
type HookAction = { type: "continue" } | { type: "terminate"; reason: string };
type ToolCallHookAction =
  | { type: "continue" }
  | { type: "skip"; reason: string }
  | { type: "terminate"; reason: string }
  | ({ type: "approval_request" } & ToolApprovalRequestOptions);

type HookResult = HookAction | undefined;
type ToolCallHookResult = ToolCallHookAction | undefined;

type ToolHookArgs = {
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  args: string;
};

type RunControl = {
  continue(): HookAction;
  cancel(reason: string): HookAction;
};

type ToolCallControl = {
  run(): ToolCallHookAction;
  skip(reason: string): ToolCallHookAction;
  cancel(reason: string): ToolCallHookAction;
  requestApproval(options?: ToolApprovalRequestOptions): ToolCallHookAction;
};
```

Purpose: give hook callbacks explicit control objects instead of requiring hand-written action objects.

Return behavior: controls create actions consumed by the active prompt request.

## Helpers

```ts
function createHook<RawResponse = unknown>(hook: PromptHook<RawResponse>): PromptHook<RawResponse>;
function cancelPrompt(reason: string): HookAction;
function skipTool(reason: string): ToolCallHookAction;
function requestToolApproval(options?: ToolApprovalRequestOptions): ToolCallHookAction;

const runControl: RunControl;
const toolCallControl: ToolCallControl;
```

Purpose: define hooks and create common hook actions.

Notable errors: terminating hooks produce `PromptCancelledError` from `@anvia/core/request`. Approval requests without a configured handler produce `ToolApprovalRequiredError` from `@anvia/core/request`.
