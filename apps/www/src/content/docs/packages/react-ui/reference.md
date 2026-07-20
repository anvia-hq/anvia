---
title: "@anvia/react-ui: Reference"
description: "Composable UI primitives from @anvia/react-ui."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 6
  label: "Reference"
---
Import from `@anvia/react-ui`.

Subpath entrypoints are also available:

- `@anvia/react-ui/chat`
- `@anvia/react-ui/completion`
- `@anvia/react-ui/attachment`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/image`
- `@anvia/react-ui/message`
- `@anvia/react-ui/selection-toolbar`
- `@anvia/react-ui/shared`
- `@anvia/react-ui/stream`
- `@anvia/react-ui/stream/styles.css`
- `@anvia/react-ui/thread-list`
- `@anvia/react-ui/styles.css`

## Primary namespaces

```ts
const Thread: {
  Root: React.ForwardRefExoticComponent<...>;
  Viewport: React.ForwardRefExoticComponent<...>;
  ViewportFooter: React.ForwardRefExoticComponent<...>;
  Messages: React.ForwardRefExoticComponent<...>;
  Empty: React.ForwardRefExoticComponent<...>;
  Status: React.ForwardRefExoticComponent<...>;
  Loading: React.ForwardRefExoticComponent<...>;
  Error: React.ForwardRefExoticComponent<...>;
  Suggestions: React.ForwardRefExoticComponent<...>;
  Suggestion: React.ForwardRefExoticComponent<...>;
  ScrollToBottom: React.ForwardRefExoticComponent<...>;
};

const Composer: {
  Root: React.ForwardRefExoticComponent<...>;
  Quote: React.ForwardRefExoticComponent<...>;
  ClearQuote: React.ForwardRefExoticComponent<...>;
  Input: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> & {
      autoResize?: boolean;
      maxRows?: number;
      minRows?: number;
      placeholder?: string;
    }
  >;
  TextareaInput: React.ForwardRefExoticComponent<
    React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
      autoResize?: boolean;
      maxRows?: number;
      minRows?: number;
    }
  >;
  TriggerMenu: React.ForwardRefExoticComponent<...>;
  TriggerItem: React.ForwardRefExoticComponent<...>;
  Attachments: React.ForwardRefExoticComponent<...>;
  AttachmentInput: React.ForwardRefExoticComponent<...>;
  AddAttachment: React.ForwardRefExoticComponent<...>;
  AttachmentDropzone: React.ForwardRefExoticComponent<...>;
  Submit: React.ForwardRefExoticComponent<...>;
  Stop: React.ForwardRefExoticComponent<...>;
};

const Attachment: {
  Root: React.ForwardRefExoticComponent<...>;
  Name: React.ForwardRefExoticComponent<...>;
  Preview: React.ForwardRefExoticComponent<...>;
  Remove: React.ForwardRefExoticComponent<...>;
};

const Image: {
  Root: React.ForwardRefExoticComponent<...>;
  Preview: React.ForwardRefExoticComponent<...>;
  Name: React.ForwardRefExoticComponent<...>;
  Actions: React.ForwardRefExoticComponent<...>;
  Copy: React.ForwardRefExoticComponent<...>;
  Download: React.ForwardRefExoticComponent<...>;
  ZoomTrigger: React.ForwardRefExoticComponent<...>;
  ZoomOverlay: React.ForwardRefExoticComponent<...>;
};

const Message: {
  Root: React.ForwardRefExoticComponent<...>;
  Content: React.ForwardRefExoticComponent<...>;
  Parts: React.ForwardRefExoticComponent<...>;
  Part: React.ForwardRefExoticComponent<...>;
  Text: React.ForwardRefExoticComponent<...>;
  Markdown: React.ForwardRefExoticComponent<...>;
  Entity: React.ForwardRefExoticComponent<MessageEntityProps & React.RefAttributes<HTMLSpanElement>>;
  CodeBlock: React.ForwardRefExoticComponent<...>;
  Reasoning: React.ForwardRefExoticComponent<...>;
  Tool: React.ForwardRefExoticComponent<...>;
  ToolName: React.ForwardRefExoticComponent<...>;
  ToolInput: React.ForwardRefExoticComponent<...>;
  ToolOutput: React.ForwardRefExoticComponent<...>;
  ToolError: React.ForwardRefExoticComponent<...>;
  ToolStatus: React.ForwardRefExoticComponent<...>;
  Attachment: React.ForwardRefExoticComponent<...>;
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
  Panel: React.ForwardRefExoticComponent<...>;
  Status: React.ForwardRefExoticComponent<...>;
  Approvals: React.ForwardRefExoticComponent<...>;
  Approval: React.ForwardRefExoticComponent<...>;
  ApprovalReason: React.ForwardRefExoticComponent<...>;
  Approve: React.ForwardRefExoticComponent<...>;
  Reject: React.ForwardRefExoticComponent<...>;
  Questions: React.ForwardRefExoticComponent<...>;
  Question: React.ForwardRefExoticComponent<...>;
  QuestionPrompt: React.ForwardRefExoticComponent<...>;
  QuestionChoice: React.ForwardRefExoticComponent<...>;
  QuestionTextAnswer: React.ForwardRefExoticComponent<...>;
  QuestionSubmit: React.ForwardRefExoticComponent<...>;
};

const SelectionToolbar: {
  Root: React.ForwardRefExoticComponent<...>;
  Quote: React.ForwardRefExoticComponent<...>;
  Copy: React.ForwardRefExoticComponent<...>;
};

const ThreadList: {
  Root: React.ForwardRefExoticComponent<...>;
  New: React.ForwardRefExoticComponent<...>;
  Items: React.ForwardRefExoticComponent<...>;
  Empty: React.ForwardRefExoticComponent<...>;
};

const ThreadListItem: {
  Root: React.ForwardRefExoticComponent<...>;
  Trigger: React.ForwardRefExoticComponent<...>;
  Title: React.ForwardRefExoticComponent<...>;
  Archive: React.ForwardRefExoticComponent<...>;
  Unarchive: React.ForwardRefExoticComponent<...>;
  Delete: React.ForwardRefExoticComponent<...>;
};
```

## Streamed text smoothing

`Message.Parts`, `Message.Text`, and `Message.Markdown` accept an optional `stream` lifecycle:

```ts
type MessageStreamOptions = {
  isStreaming: boolean;
  resetKey: string | number;
  flushImmediately?: boolean;
};
```

Smoothing is disabled by default. Keep `stream` present when `isStreaming` changes to `false` so
buffered text drains. `Message.Parts` smooths text and reasoning together and delays later opaque
parts, such as tools, until preceding text is visible. The underlying `useChat` controller and
`UIMessage[]` remain unchanged.

`Message.Markdown` also accepts `renderEntity?: (entity: ComposerEntity) => ReactNode`. Valid
entities from `message.metadata.composer.entities` render through `Message.Entity` by default.

```ts
type MessageEntityProps = React.HTMLAttributes<HTMLSpanElement> & {
  entity: ComposerEntity;
};
```

The default span emits `data-anvia-message-entity`, `data-entity-id`, and `data-trigger-id`. It does
not serialize `entity.data` into the DOM.

## StreamMarkdown

Import `StreamMarkdown` from `@anvia/react-ui` or `@anvia/react-ui/stream`:

```ts
type StreamMarkdownProps = React.HTMLAttributes<HTMLDivElement> & {
  content: string;
  live?: boolean;
  components?: Components;
  remarkPlugins?: ReactMarkdownOptions["remarkPlugins"];
  remarkRehypeOptions?: ReactMarkdownOptions["remarkRehypeOptions"];
};
```

`StreamMarkdown` is context-free and does not pace content itself. It keeps completed top-level
Markdown blocks stable as `content` grows and applies a two-band reveal only to text in the final
live block. Preformatted code is excluded. Import `@anvia/react-ui/stream/styles.css` when using the
subpath by itself.

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

type ThreadListRecord = {
  id: string;
  title?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  archived?: boolean;
  metadata?: unknown;
};

type ThreadListController = {
  threads: ThreadListRecord[];
  activeThreadId?: string;
  status?: "idle" | "loading" | "error";
  error?: unknown;
  createThread(): Promise<void> | void;
  switchThread(threadId: string): Promise<void> | void;
  archiveThread?(threadId: string): Promise<void> | void;
  unarchiveThread?(threadId: string): Promise<void> | void;
  deleteThread?(threadId: string): Promise<void> | void;
};

type ThreadListProviderProps = {
  controller: ThreadListController;
  children?: React.ReactNode;
};

function ChatProvider<TEvent = unknown>(props: ChatProviderProps<TEvent>): React.ReactElement;
function CompletionProvider<TEvent = unknown>(
  props: CompletionProviderProps<TEvent>,
): React.ReactElement;
function ThreadListProvider(props: ThreadListProviderProps): React.ReactElement;
```

Purpose: provide `@anvia/react` hook results and app-owned thread-list controllers to UI
primitives without prop drilling.

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
  attachments: UIAttachment[];
  setAttachments(update: ComposerAttachmentsUpdate): void;
  addAttachment(attachment: File | CreateUIAttachment): Promise<void>;
  removeAttachment(id: string): void;
  clearAttachments(): void;
  entities: ComposerEntity[];
  setEntities(update: ComposerEntitiesUpdate): void;
  quote?: ComposerQuote;
  setQuote(quote: ComposerQuote | undefined): void;
  clearQuote(): void;
  triggers: ComposerTriggerDefinition[];
  activeTrigger?: ComposerTriggerState;
  setActiveTrigger(update: ComposerTriggerStateUpdate): void;
  submit(): Promise<void>;
  stop(): void;
  status: ChatController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

type ComposerQuote = {
  text: string;
  messageId: string;
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

type ComposerAttachmentInput = File | CreateUIAttachment;
type ComposerAttachmentsUpdate =
  | UIAttachment[]
  | ((attachments: UIAttachment[]) => UIAttachment[]);

type ComposerEntitiesUpdate =
  | ComposerEntity[]
  | ((entities: ComposerEntity[]) => ComposerEntity[]);

type ComposerEntityData =
  | string
  | number
  | boolean
  | null
  | ComposerEntityData[]
  | { [key: string]: ComposerEntityData | undefined };

type ComposerTriggerItem = {
  id: string;
  label: string;
  text?: string;
  detail?: React.ReactNode;
  data?: ComposerEntityData;
  disabled?: boolean;
};

type ComposerTriggerItemsArgs = {
  trigger: ComposerTriggerDefinition;
  query: string;
  input: string;
  entities: ComposerEntity[];
  signal: AbortSignal;
};

type ComposerTriggerItems =
  | ComposerTriggerItem[]
  | ((args: ComposerTriggerItemsArgs) => ComposerTriggerItem[] | Promise<ComposerTriggerItem[]>);

type ComposerTriggerDefinition = {
  id: string;
  char: string;
  items: ComposerTriggerItems;
  minQueryLength?: number;
  allowedPrefixes?: string[] | null;
  startOfLine?: boolean;
  allowSpaces?: boolean;
};

type ComposerEntity = {
  id: string;
  triggerId: string;
  trigger: string;
  label: string;
  text: string;
  range: {
    from: number;
    to: number;
  };
  data?: ComposerEntityData;
};

type ComposerMessageMetadata = {
  composer: {
    entities: ComposerEntity[];
  };
};

type ComposerTriggerState = {
  trigger: ComposerTriggerDefinition;
  query: string;
  items: ComposerTriggerItem[];
  loading: boolean;
  selectedIndex: number;
  rect?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
  selectItem(item: ComposerTriggerItem): void;
  setSelectedIndex(index: number): void;
};

type ComposerTriggerStateUpdate =
  | ComposerTriggerState
  | undefined
  | ((state: ComposerTriggerState | undefined) => ComposerTriggerState | undefined);

type ComposerSubmitMessageArgs<TEvent = unknown> = {
  input: string;
  attachments: UIAttachment[];
  entities: ComposerEntity[];
  chat: ChatController<TEvent>;
  quote?: ComposerQuote;
  clear(): void;
};

type ComposerSubmitMessage<TEvent = unknown> = (
  args: ComposerSubmitMessageArgs<TEvent>,
) => Promise<void> | void;
```

`Composer.Root` also accepts `defaultInput`, `defaultAttachments`, `defaultEntities`,
`defaultQuote`, `input`, `onInputChange`, `attachments`, `onAttachmentsChange`, `entities`,
`onEntitiesChange`, `quote`, `onQuoteChange`, and `triggers` for uncontrolled or controlled
composer state. Use `submitMessage` to replace the default send behavior when an app needs custom
message payloads or metadata. For trigger usage, see
[Composer triggers](/docs/react-ui/composer-triggers).

## Context hooks

```ts
function useChatContext<TEvent = unknown>(): ChatController<TEvent>;
function useCompletionContext<TEvent = unknown>(): CompletionController<TEvent>;
function useThread(): ThreadContextValue;
function useComposer(): ComposerContextValue;
function useCompletionInput(): CompletionInputContextValue;
function useAttachment(): AttachmentContextValue;
function useImage(): ImageContextValue;

type MessageContextValue = { message: UIMessage };
type MessagePartContextValue = { part: UIMessagePart };
type MessagePartsFilter = (part: UIMessagePart) => boolean;
type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageAttachmentPart = Extract<UIMessagePart, { type: "attachment" }>;
type MessageToolRenderWhen = "always" | "pending" | "settled";

function useMessage(): MessageContextValue;
function useMessagePart(): MessagePartContextValue;

type ApprovalContextValue = {
  approval: ToolApproval;
  reason: string;
  setReason(reason: string): void;
};
type AttachmentContextValue = {
  attachment: UIAttachment;
  remove?(): void;
};
type QuestionContextValue = {
  question: ToolQuestion;
  answers: Record<string, ToolQuestionAnswer>;
  setAnswer(prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer): void;
};
type QuestionPromptContextValue = { prompt: ToolQuestionPrompt };
type ImageContextValue = {
  attachment: UIAttachment;
  src?: string;
  name?: string;
  mediaType?: string;
  isImage: boolean;
  zoomOpen: boolean;
  setZoomOpen(open: boolean): void;
};
type SelectionToolbarSelection = {
  text: string;
  messageId: string;
  rect: DOMRect;
};
type SelectionToolbarContextValue = {
  selection?: SelectionToolbarSelection;
  quote(): void;
  copy(): Promise<void>;
  clear(): void;
};
type ThreadListItemContextValue = {
  thread: ThreadListRecord;
  active: boolean;
};

function useHumanInput(): UseChatResult["humanInput"];
function useApproval(): ApprovalContextValue;
function useQuestion(): QuestionContextValue;
function useQuestionPrompt(): QuestionPromptContextValue;
function useSelectionToolbar(): SelectionToolbarContextValue;
function useThreadList(): ThreadListController;
function useThreadListItem(): ThreadListItemContextValue;
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

`Composer.Attachments`, `Thread.Messages`, `Thread.Suggestions`, `HumanInput.Approvals`, and
`HumanInput.Questions` accept `keepMounted?: boolean` for layout control when their collection is
empty.

`Image.Root` reads the current attachment context or an explicit `attachment` prop. Use it inside
`Message.Attachment` or `Attachment.Root` for image previews, image copy/download actions, and a
portal zoom overlay.

`SelectionToolbar.Root` renders only when selected text is fully inside one `Message.Root`. Use
`onQuote` with controlled `Composer.Root` `quote`/`onQuoteChange` state to bridge selected text into
`Composer.Quote`.

`ThreadListProvider` accepts an app-owned `ThreadListController`. `ThreadList.Items` renders
non-archived threads by default and accepts `archived` for archived lists.

## Styling

Import `@anvia/react-ui/styles.css` for functional prototype styling, or target the emitted
`data-anvia-*` attributes directly. Standalone `StreamMarkdown` consumers can import only
`@anvia/react-ui/stream/styles.css`. Application CSS owns layout, spacing, colors, and cards.
