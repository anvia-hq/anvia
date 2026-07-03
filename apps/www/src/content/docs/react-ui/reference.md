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
  Message,
  Attachment,
  HumanInput,
  Completion,
} from "@anvia/react-ui";
```

Subpath entrypoints are also available:

- `@anvia/react-ui/chat`
- `@anvia/react-ui/completion`
- `@anvia/react-ui/attachment`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/message`
- `@anvia/react-ui/shared`
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
| `Composer.Root` | `form` | `input`, `onInputChange`, `attachments`, `onAttachmentsChange`, `defaultInput`, `defaultAttachments`, `submitMessage` | Owns draft text, pending attachments, submit, stop. |
| `Composer.Input` | `textarea` | `minRows`, `maxRows`, `autoResize` | Controlled by composer context; Enter submits, Shift+Enter adds newline. |
| `Composer.Attachments` | `div` | `keepMounted`, child function | Renders pending attachments. |
| `Composer.AttachmentInput` | `input type="file"` | `accept`, `multiple` | Adds selected files. |
| `Composer.AddAttachment` | `button` | `accept`, `multiple` | Opens a hidden file picker. |
| `Composer.AttachmentDropzone` | `div` | `disabled` | Adds dropped files and emits drag state. |
| `Composer.Submit` | `button` | `asChild` | Submits current draft or attachments. |
| `Composer.Stop` | `button` | `asChild` | Stops active stream. |

Custom submit signature:

```tsx
<Composer.Root
  submitMessage={async ({ input, attachments, chat, clear }) => {
    await chat.sendMessage({ text: input, attachments, metadata: { source: "composer" } });
    clear();
  }}
/>
```

## Message

Message primitives must be rendered inside `Thread.Messages`, or inside an internal message
provider supplied by that list.

| Primitive | Element | Key props | Behavior |
| --- | --- | --- | --- |
| `Message.Root` | `article` | child function via parent | Provides one `UIMessage`. |
| `Message.Content` | `div` | element props | Wraps message body. |
| `Message.Parts` | `div` | `filter`, child function | Renders message parts. |
| `Message.Part` | `div` | child function | Provides one `UIMessagePart`. |
| `Message.Text` | `span` | element props | Renders text part as plain text. |
| `Message.Markdown` | `div` | `components`, `remarkPlugins` | Renders text with GitHub-flavored Markdown. |
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
- `useMessage`
- `useMessagePart`
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
| `data-part` on message parts | `text`, `reasoning`, `tool`, `attachment`, `data`, `error` |
| `data-state` on tool cards | `input-streaming`, `input-available`, `output-available`, `error` |
| `data-dragging` on attachment dropzone | present while dragging |

The package reference coverage script checks the package-scoped reference file that mirrors the
published API surface. This page is the product-facing reference for implementation decisions.
