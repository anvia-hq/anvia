---
title: Reference
description: Public imports, namespaces, props, hooks, and styling contracts for @anvia/react-ui.
section: react-ui
sidebar:
  group: Resources
  order: 2
  label: Reference
---

Import from `@anvia/react-ui`:

```tsx
import {
  ChatProvider,
  CompletionProvider,
  Thread,
  Composer,
  type ComposerEntity,
  type ComposerEntityData,
  type ComposerMessageMetadata,
  type ComposerTriggerDefinition,
  type ComposerTriggerItem,
  type ComposerTriggerItemsArgs,
  Message,
  Attachment,
  Image,
  SelectionToolbar,
  ThreadList,
  ThreadListItem,
  ThreadListProvider,
  HumanInput,
  Completion,
} from "@anvia/react-ui";
```

Subpath entrypoints are also available:

- `@anvia/react-ui/chat`
- `@anvia/react-ui/completion`
- `@anvia/react-ui/attachment`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/image`
- `@anvia/react-ui/message`
- `@anvia/react-ui/selection-toolbar`
- `@anvia/react-ui/shared`
- `@anvia/react-ui/thread-list`
- `@anvia/react-ui/styles.css`

## Providers

| Provider | Requires | Use |
| --- | --- | --- |
| `ChatProvider` | `useChat(...)` result | Chat, messages, composer, tool rendering, human input. |
| `CompletionProvider` | `useCompletion(...)` result | Prompt-to-text completion surfaces. |

```tsx
const chat = useChat({ endpoint: "http://localhost:8787/api/chat" });

return (
  <ChatProvider controller={chat}>
    <Thread.Root>{/* chat UI */}</Thread.Root>
  </ChatProvider>
);
```

## Thread

Thread primitives must be rendered inside `ChatProvider`.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Thread.Root` | `div` | `asChild`, element props | Provides thread context and emits chat status. |
| `Thread.Viewport` | `div` | `autoScroll?: boolean` | Registers scroll container and bottom detection. |
| `Thread.ViewportFooter` | `div` | element props | Positions footer content inside viewport. |
| `Thread.Messages` | `div` | `keepMounted?: boolean`, child function | Renders current `UIMessage[]`. |
| `Thread.Empty` | `div` | element props | Renders only when there are no messages. |
| `Thread.Status` | `div` | child function | Renders `idle`, `streaming`, or `error`. |
| `Thread.Loading` | `div` | element props | Renders only while streaming. |
| `Thread.Error` | `div` | child function | Renders controller error with `role="alert"`. |
| `Thread.Suggestions` | `div` | `keepMounted?: boolean`, child function | Renders configured suggestions. |
| `Thread.Suggestion` | `button` | `suggestion`, `prompt` | Sends suggestion prompt. |
| `Thread.ScrollToBottom` | `button` | element props | Scrolls viewport to latest message. |

Child signatures:

```tsx
<Thread.Messages>{(message) => <Message.Root />}</Thread.Messages>
<Thread.Suggestions>{(suggestion) => <Thread.Suggestion suggestion={suggestion} />}</Thread.Suggestions>
<Thread.Status>{(status) => status}</Thread.Status>
<Thread.Error>{(error) => String(error)}</Thread.Error>
```

## Composer

Composer primitives must be rendered inside `ChatProvider`.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Composer.Root` | `form` | `input`, `onInputChange`, `attachments`, `onAttachmentsChange`, `entities`, `onEntitiesChange`, `quote`, `onQuoteChange`, `defaultInput`, `defaultAttachments`, `defaultEntities`, `defaultQuote`, `triggers`, `submitMessage` | Owns draft text, pending attachments, selected entities, quote state, submit, stop. |
| `Composer.Quote` | `blockquote` | child function | Renders the active quote when present. |
| `Composer.ClearQuote` | `button` | `asChild` | Clears the active quote. |
| `Composer.Input` | `div` | `minRows`, `maxRows`, `autoResize`, `placeholder` | Rich composer input controlled by composer context; Enter submits, Shift+Enter adds newline. |
| `Composer.TextareaInput` | `textarea` | `minRows`, `maxRows`, `autoResize` | Native textarea fallback controlled by composer context. |
| `Composer.TriggerMenu` | `div` | `keepMounted`, child function | Renders the active trigger menu for `Composer.Input`. |
| `Composer.TriggerItem` | `button` | `item`, `index`, child function | Selects a trigger item and inserts an inline entity. |
| `Composer.Attachments` | `div` | `keepMounted`, child function | Renders pending attachments. |
| `Composer.AttachmentInput` | `input type="file"` | `accept`, `multiple` | Adds selected files. |
| `Composer.AddAttachment` | `button` | `accept`, `multiple` | Opens a hidden file picker. |
| `Composer.AttachmentDropzone` | `div` | `disabled` | Adds dropped files and emits drag state. |
| `Composer.Submit` | `button` | `asChild` | Submits current draft or attachments. |
| `Composer.Stop` | `button` | `asChild` | Stops active stream. |

Custom submit signature:

```tsx
<Composer.Root
  submitMessage={async ({ input, attachments, entities, quote, chat, clear }) => {
    await chat.sendMessage({
      text: input,
      attachments,
      metadata: { source: "composer", composer: { entities } },
    });
    clear();
  }}
/>
```

When default submit is used with a quote, the submitted text includes a Markdown blockquote prefix
and the UI message metadata includes `{ quote: { text, messageId } }`. When selected entities are
present, metadata also includes `{ composer: { entities } }`.

### Composer triggers and entities

`Composer.Input` supports inline entity triggers such as `@`, `/`, or `$` through
`Composer.Root`'s `triggers` prop.

```tsx
const triggers: ComposerTriggerDefinition[] = [
  {
    id: "people",
    char: "@",
    items: [{ id: "user_ada", label: "Ada Lovelace", data: { type: "user" } }],
  },
];

<Composer.Root triggers={triggers}>
  <Composer.Input />
  <Composer.TriggerMenu />
</Composer.Root>;
```

Trigger definitions:

| Field | Type | Use |
| --- | --- | --- |
| `id` | `string` | Stable trigger catalog id stored on submitted entities. |
| `char` | `string` | Trigger character such as `@`, `/`, or `$`. |
| `items` | `ComposerTriggerItem[]` or resolver | Static items or an async item source. |
| `minQueryLength` | `number` | Minimum typed query length before item lookup. |
| `allowedPrefixes` | `string[] \| null` | Prefixes allowed before the trigger, or any prefix when `null`. |
| `startOfLine` | `boolean` | Only open the trigger at the start of a line. |
| `allowSpaces` | `boolean` | Keep the trigger active when the query includes spaces. |

Trigger item fields:

| Field | Type | Use |
| --- | --- | --- |
| `id` | `string` | Stable item id. |
| `label` | `string` | Menu label and default inserted text after the trigger char. |
| `text` | `string` | Optional plain text inserted into the submitted message. |
| `detail` | `ReactNode` | Optional secondary content for custom menus. |
| `data` | JSON-like value | App-owned metadata copied onto submitted entities. |
| `disabled` | `boolean` | Renders the item disabled and prevents selection. |

Async item resolvers receive:

```ts
type ComposerTriggerItemsArgs = {
  trigger: ComposerTriggerDefinition;
  query: string;
  input: string;
  entities: ComposerEntity[];
  signal: AbortSignal;
};
```

Submitted entities:

```ts
type ComposerEntity = {
  id: string;
  triggerId: string;
  trigger: string;
  label: string;
  text: string;
  range: { from: number; to: number };
  data?: ComposerEntityData;
};

type ComposerMessageMetadata = {
  composer: { entities: ComposerEntity[] };
};
```

Use `entities`, `defaultEntities`, and `onEntitiesChange` on `Composer.Root` when selected entities
need to be controlled by application state. For a full guide, see
[Composer triggers](/docs/react-ui/composer-triggers).

Entity ranges use JavaScript UTF-16 offsets. Default quote submission shifts them to match the
prefixed message text.

## Message

Message primitives must be rendered inside `Thread.Messages`, or inside an internal message
provider supplied by that list.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Message.Root` | `article` | child function via parent | Provides one `UIMessage`. |
| `Message.Content` | `div` | element props | Wraps message body. |
| `Message.Parts` | `div` | `filter`, `stream`, child function | Renders message parts and can preserve text/tool reveal order. |
| `Message.Part` | `div` | child function | Provides one `UIMessagePart`. |
| `Message.Text` | `span` | `stream`, element props | Renders text part as plain text. |
| `Message.Markdown` | `div` | `stream`, `components`, `remarkPlugins`, `renderEntity` | Renders stable-block GitHub-flavored Markdown and validated Composer entities. |
| `Message.Entity` | `span` | `entity`, span props | Renders headless semantic entity markup. |
| `Message.CodeBlock` | `pre` | `code`, `language` | Markdown code block helper. |
| `Message.Reasoning` | `details` | element props | Renders reasoning parts. |
| `Message.Tool` | `div` | `renderWhen` | Renders tool parts. |
| `Message.Attachment` | `div` | child function | Renders attachment parts. |
| `Message.Data` | `pre` | element props | Renders structured data parts. |
| `Message.Error` | `div` | element props | Renders error parts. |
| `Message.Actions` | `div` | element props | Groups message actions. |
| `Message.Copy` | `button` | `asChild` | Copies message text. |
| `Message.Regenerate` | `button` | `asChild` | Regenerates latest assistant message. |

Tool helpers: `Message.ToolName`, `Message.ToolStatus`, `Message.ToolInput`,
`Message.ToolOutput`, and `Message.ToolError`.

```ts
type MessageEntityProps = React.HTMLAttributes<HTMLSpanElement> & {
  entity: ComposerEntity;
};
```

`Message.Entity` emits `data-anvia-message-entity`, `data-entity-id`, and `data-trigger-id` and uses
`entity.text` as its default children. `Message.Markdown` reads entities from
`message.metadata.composer.entities`; malformed ranges remain ordinary text.

Child signatures:

```tsx
<Message.Parts>{(part) => <Message.Part />}</Message.Parts>
<Message.Tool>{(toolPart) => <ToolCard part={toolPart} />}</Message.Tool>
<Message.Attachment>{(attachment) => <AttachmentPreview attachment={attachment} />}</Message.Attachment>
```

`Message.Tool` `renderWhen` values:

| Value | Renders for |
| --- | --- |
| `always` | All tool states. |
| `pending` | `input-streaming`, `input-available`. |
| `settled` | `output-available`, `error`. |

## Attachment

Attachment primitives are used inside `Composer.Attachments` or `Message.Attachment`.

| Primitive | Element | Behavior |
| --- | --- | --- |
| `Attachment.Root` | `div` | Provides one attachment row. |
| `Attachment.Name` | `span` | Renders attachment name. |
| `Attachment.Preview` | `div` | Renders image/link/kind preview. |
| `Attachment.Remove` | `button` | Removes pending composer attachment when removable. |

## Image

Image primitives are used inside `Message.Attachment`, `Attachment.Root`, or with an explicit
`attachment` prop.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Image.Root` | `figure` | `attachment`, `renderWhen` | Provides image context for one `UIAttachment`. |
| `Image.Preview` | `div` | `loadingFallback`, `errorFallback`, `alt` | Renders an image with loading/error state. |
| `Image.Name` | `figcaption` | element props | Renders attachment name or media type. |
| `Image.Actions` | `div` | element props | Groups image actions. |
| `Image.Copy` | `button` | `asChild` | Copies image data when Clipboard image support exists. |
| `Image.Download` | `button` | `filename` | Downloads the image URL or data URL. |
| `Image.ZoomTrigger` | `button` | `asChild` | Opens the zoom overlay. |
| `Image.ZoomOverlay` | `div` | `container` | Portals a zoomed image overlay and closes on Escape or click. |

```tsx
<Message.Attachment>
  <Image.Root>
    <Image.ZoomTrigger>
      <Image.Preview />
    </Image.ZoomTrigger>
    <Image.Name />
    <Image.Actions>
      <Image.Copy />
      <Image.Download />
    </Image.Actions>
    <Image.ZoomOverlay />
  </Image.Root>
</Message.Attachment>
```

## SelectionToolbar

Selection toolbar primitives render when selected text is fully inside one `Message.Root`.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `SelectionToolbar.Root` | `div` | `onQuote`, `onSelectionChange`, `container` | Portals a floating toolbar above selected message text. |
| `SelectionToolbar.Quote` | `button` | `asChild` | Calls `onQuote` with `{ text, messageId, rect }`. |
| `SelectionToolbar.Copy` | `button` | `asChild` | Copies selected text. |

Quote bridging is controlled by app state:

```tsx
const [quote, setQuote] = useState<ComposerQuote>();

return (
  <Thread.Root>
    <Thread.Messages />
    <SelectionToolbar.Root onQuote={setQuote} />
    <Composer.Root quote={quote} onQuoteChange={setQuote}>
      <Composer.Quote />
      <Composer.ClearQuote />
      <Composer.Input />
      <Composer.Submit />
    </Composer.Root>
  </Thread.Root>
);
```

## ThreadList

Thread-list primitives require an app-owned `ThreadListController`. They do not create storage or
chat persistence by themselves.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `ThreadListProvider` | provider | `controller` | Provides a thread-list controller. |
| `ThreadList.Root` | `div` | element props | Emits status and handles Arrow/Home/End trigger focus. |
| `ThreadList.New` | `button` | `asChild` | Calls `controller.createThread`. |
| `ThreadList.Items` | `div` | `archived`, `keepMounted`, child function | Renders filtered threads. |
| `ThreadList.Empty` | `div` | element props | Renders when no non-archived threads exist. |
| `ThreadListItem.Root` | `div` | element props | Provides one thread item and active state. |
| `ThreadListItem.Trigger` | `button` | `asChild` | Calls `controller.switchThread(thread.id)`. |
| `ThreadListItem.Title` | `span` | `fallback` | Renders thread title. |
| `ThreadListItem.Archive` | `button` | `asChild` | Calls optional archive action. |
| `ThreadListItem.Unarchive` | `button` | `asChild` | Calls optional unarchive action. |
| `ThreadListItem.Delete` | `button` | `asChild` | Calls optional delete action. |

```tsx
<ThreadListProvider controller={threadList}>
  <ThreadList.Root>
    <ThreadList.New />
    <ThreadList.Items>
      <ThreadListItem.Root>
        <ThreadListItem.Trigger>
          <ThreadListItem.Title fallback="New chat" />
        </ThreadListItem.Trigger>
        <ThreadListItem.Archive />
        <ThreadListItem.Delete />
      </ThreadListItem.Root>
    </ThreadList.Items>
  </ThreadList.Root>
</ThreadListProvider>
```

## HumanInput

Human-input primitives must be rendered inside `ChatProvider` and require `useChat({ humanInput })`
when decisions should post back to a route.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `HumanInput.Panel` | `div` | `filter` | Renders when approvals or questions are pending. |
| `HumanInput.Status` | `div` | child function | Shows pending count. |
| `HumanInput.Approvals` | `div` | `filter`, `keepMounted`, child function | Renders tool approvals. |
| `HumanInput.Approval` | `div` | element props | Provides one approval. |
| `HumanInput.ApprovalReason` | `textarea` | element props | Captures decision reason. |
| `HumanInput.Approve` | `button` | `asChild` | Posts approval decision. |
| `HumanInput.Reject` | `button` | `asChild` | Posts rejection decision. |
| `HumanInput.Questions` | `div` | `filter`, `keepMounted` | Renders pending questions. |
| `HumanInput.Question` | `div` | element props | Provides one question. |
| `HumanInput.QuestionPrompt` | `div` | child function | Provides one prompt. |
| `HumanInput.QuestionChoice` | `button` | `value` | Selects a choice. |
| `HumanInput.QuestionTextAnswer` | `input` | element props | Captures free text. |
| `HumanInput.QuestionSubmit` | `button` | `asChild` | Posts question answers. |

## Completion

Completion primitives must be rendered inside `CompletionProvider`.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Completion.Root` | `div` | element props | Emits completion status. |
| `Completion.Output` | `div` | child function | Renders generated text. |
| `Completion.Form` | `form` | element props | Provides completion input context. |
| `Completion.Input` | `textarea` | element props | Tracks prompt input. |
| `Completion.Submit` | `button` | `asChild` | Starts completion. |
| `Completion.Stop` | `button` | `asChild` | Stops active stream. |

## Hooks

Use hooks only inside the matching provider/context:

- `useChatContext`
- `useComposer`
- `useThread`
- `useAttachment`
- `useImage`
- `useMessage`
- `useMessagePart`
- `useSelectionToolbar`
- `useThreadList`
- `useThreadListItem`
- `useHumanInput`
- `useApproval`
- `useQuestion`
- `useQuestionPrompt`
- `useCompletionContext`
- `useCompletionInput`

## Stable attributes

Style state with attributes instead of component names:

| Attribute | Values |
| --- | --- |
| `data-state` on thread/composer/completion roots | `idle`, `streaming`, `error` |
| `data-state` on buttons | `enabled`, `disabled` |
| `data-state` on scroll controls | `bottom`, `away` |
| `data-role` on messages | `user`, `assistant`, `system`, `tool` |
| `data-anvia-message-id` on messages | the `UIMessage.id` |
| `data-part` on message parts | `text`, `reasoning`, `tool`, `attachment`, `data`, `error` |
| `data-state` on tool cards | `input-streaming`, `input-available`, `output-available`, `error` |
| `data-dragging` on attachment dropzone | present while dragging |
| `data-active` on thread-list items | present for the active thread |

The package reference coverage script checks the package-scoped reference file that mirrors the
published API surface. This page is the product-facing reference for implementation decisions.
