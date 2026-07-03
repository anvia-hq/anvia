---
title: "React UI"
description: "Composable UI primitives from @anvia/react-ui."
section: packages
sidebar:
  group: "react-ui"
  order: 6
  label: "React UI"
---
Import from `@anvia/react-ui`.

Subpath entrypoints are also available:

- `@anvia/react-ui/chat`
- `@anvia/react-ui/completion`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/message`
- `@anvia/react-ui/shared`
- `@anvia/react-ui/styles.css`

## Primary namespaces

```ts
const Thread: {
  Root: React.ForwardRefExoticComponent<...>;
  Viewport: React.ForwardRefExoticComponent<...>;
  Messages: React.ForwardRefExoticComponent<...>;
  Empty: React.ForwardRefExoticComponent<...>;
  ScrollToBottom: React.ForwardRefExoticComponent<...>;
};

const Composer: {
  Root: React.ForwardRefExoticComponent<...>;
  Input: React.ForwardRefExoticComponent<...>;
  Submit: React.ForwardRefExoticComponent<...>;
  Stop: React.ForwardRefExoticComponent<...>;
};

const Message: {
  Root: React.ForwardRefExoticComponent<...>;
  Content: React.ForwardRefExoticComponent<...>;
  Parts: React.ForwardRefExoticComponent<...>;
  Part: React.ForwardRefExoticComponent<...>;
  Text: React.ForwardRefExoticComponent<...>;
  Reasoning: React.ForwardRefExoticComponent<...>;
  Tool: React.ForwardRefExoticComponent<...>;
  Data: React.ForwardRefExoticComponent<...>;
  Error: React.ForwardRefExoticComponent<...>;
  Actions: React.ForwardRefExoticComponent<...>;
  Copy: React.ForwardRefExoticComponent<...>;
  Regenerate: React.ForwardRefExoticComponent<...>;
};

const Completion: {
  Root: React.ForwardRefExoticComponent<...>;
  Output: React.ForwardRefExoticComponent<...>;
  Form: React.ForwardRefExoticComponent<...>;
  Input: React.ForwardRefExoticComponent<...>;
  Submit: React.ForwardRefExoticComponent<...>;
  Stop: React.ForwardRefExoticComponent<...>;
};

const HumanInput: {
  Approvals: React.ForwardRefExoticComponent<...>;
  Approval: React.ForwardRefExoticComponent<...>;
  Approve: React.ForwardRefExoticComponent<...>;
  Reject: React.ForwardRefExoticComponent<...>;
  Questions: React.ForwardRefExoticComponent<...>;
  Question: React.ForwardRefExoticComponent<...>;
  QuestionPrompt: React.ForwardRefExoticComponent<...>;
  QuestionChoice: React.ForwardRefExoticComponent<...>;
  QuestionSubmit: React.ForwardRefExoticComponent<...>;
};
```

## Providers

```ts
type ChatController<TEvent = unknown> = UseChatResult<TEvent>;
type CompletionController<TEvent = unknown> = UseCompletionResult<TEvent>;

type ChatProviderProps<TEvent = unknown> = {
  controller: ChatController<TEvent>;
  children?: React.ReactNode;
};

type CompletionProviderProps<TEvent = unknown> = {
  controller: CompletionController<TEvent>;
  children?: React.ReactNode;
};

function ChatProvider<TEvent = unknown>(props: ChatProviderProps<TEvent>): React.ReactElement;
function CompletionProvider<TEvent = unknown>(
  props: CompletionProviderProps<TEvent>,
): React.ReactElement;
```

Purpose: provide `@anvia/react` hook results to UI primitives without prop drilling.

## Shared primitive types

```ts
type PrimitiveProps<TElement extends React.ElementType = "div"> =
  React.ComponentPropsWithoutRef<TElement> & {
    asChild?: boolean;
  };

type PrimitiveRef<TElement extends React.ElementType> =
  React.ComponentPropsWithRef<TElement>["ref"];

type ThreadContextValue = {
  viewportRef: React.MutableRefObject<HTMLElement | null>;
  atBottom: boolean;
  setAtBottom(atBottom: boolean): void;
  scrollToBottom(behavior?: ScrollBehavior): void;
};

type ComposerContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: ChatController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

type CompletionInputContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: CompletionController["status"];
  canSubmit: boolean;
  canStop: boolean;
};
```

## Context hooks

```ts
function useChatContext<TEvent = unknown>(): ChatController<TEvent>;
function useCompletionContext<TEvent = unknown>(): CompletionController<TEvent>;
function useThread(): ThreadContextValue;
function useComposer(): ComposerContextValue;
function useCompletionInput(): CompletionInputContextValue;

type MessageContextValue = { message: UIMessage };
type MessagePartContextValue = { part: UIMessagePart };
type MessagePartsFilter = (part: UIMessagePart) => boolean;
type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolRenderWhen = "always" | "pending" | "settled";

function useMessage(): MessageContextValue;
function useMessagePart(): MessagePartContextValue;

type ApprovalContextValue = { approval: ToolApproval };
type QuestionContextValue = {
  question: ToolQuestion;
  answers: Record<string, ToolQuestionAnswer>;
  setAnswer(prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer): void;
};
type QuestionPromptContextValue = { prompt: ToolQuestionPrompt };

function useHumanInput(): UseChatResult["humanInput"];
function useApproval(): ApprovalContextValue;
function useQuestion(): QuestionContextValue;
function useQuestionPrompt(): QuestionPromptContextValue;
```

Purpose: read primitive-local state when composing custom renderers.

`Message.Tool` accepts either React children or a render function:

```tsx
<Message.Tool>
  {(tool: MessageToolPart) => <ToolCard input={tool.input} output={tool.output} />}
</Message.Tool>
```

`Message.Tool` also accepts `renderWhen?: MessageToolRenderWhen`, and `Message.Parts` accepts
`filter?: MessagePartsFilter`.

## Styling

Import `@anvia/react-ui/styles.css` for default styling, or target the emitted `data-anvia-*` attributes directly.
