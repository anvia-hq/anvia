---
title: "@anvia/react-ui: Usage Patterns"
description: "Common ways to compose @anvia/react-ui with @anvia/react."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 3
  label: "Usage Patterns"
---
## Pair with @anvia/react

`@anvia/react-ui` expects controllers from `@anvia/react`.

- Use `useChat(...)` with `ChatProvider`, `Thread`, `Message`, `Composer`, and `HumanInput`.
- Use `useCompletion(...)` with `CompletionProvider` and `Completion`.
- Keep server routes, auth, persistence, and model selection outside the UI package.

React routes should accept the `@anvia/react` request shape `{ messages, stream: true }`. See
[React UI server routes](/docs/react-ui/server-routes) for complete examples.

## Use as headless primitives

Every primitive supports `className` and stable `data-anvia-*` attributes. Button-like primitives also support `asChild`, so applications can attach behavior to design-system components.

```tsx
<Composer.Submit asChild>
  <button className="primary-action">Send</button>
</Composer.Submit>
```

## Render Anvia agent parts

`Message.Parts` renders Anvia `UIMessagePart` values by default:

- `text`
- `reasoning`
- `tool`
- `attachment`
- `data`
- `error`

For custom rendering, pass children to `Message.Part` or use `useMessagePart()`.
`Message.Tool` also accepts a render function for merged tool-call input/result cards:

```tsx
<Message.Parts>
  {(part) =>
    part.type === "tool" ? (
      <Message.Part>
        <Message.Tool>
          {(tool) => (
            <ToolCard name={tool.toolName} input={tool.input} output={tool.output} />
          )}
        </Message.Tool>
      </Message.Part>
    ) : part.type === "attachment" ? (
      <Message.Part>
        <Message.Attachment />
      </Message.Part>
    ) : (
      <Message.Part />
    )
  }
</Message.Parts>
```

Tool rendering is not locked to one timing. Render immediately, only while pending, only when settled,
or filter tool parts before wrappers are created:

```tsx
<Message.Tool renderWhen="always" />
<Message.Tool renderWhen="pending" />
<Message.Tool renderWhen="settled" />

<Message.Parts
  filter={(part) => part.type !== "tool" || part.state === "output-available"}
/>
```

## Human input

`HumanInput.Approvals` and `HumanInput.Questions` read `useChat` human-input state and call the matching controller actions. They are meant for tool approval and question workflows emitted by Anvia agents or Studio-compatible streams.

Application code owns the decision and answer routes. See
[Human review end to end](/docs/react-ui/human-review-end-to-end).

## Attachments and Markdown

Use `Composer.Attachments`, `Composer.AttachmentInput`, `Composer.AddAttachment`, and
`Composer.AttachmentDropzone` for pending file attachments. `Composer.Input` auto-resizes from
`minRows` to `maxRows` rows, with `maxRows` defaulting to `6`.

Keep `Composer.Root` uncontrolled for simple chat surfaces. Use `input`, `onInputChange`,
`attachments`, and `onAttachmentsChange` when the draft or pending attachments need to sync with
application state.

```tsx
<Composer.Root
  input={draft}
  onInputChange={setDraft}
  attachments={attachments}
  onAttachmentsChange={setAttachments}
>
  <Composer.Attachments keepMounted />
  <Composer.AttachmentInput multiple />
  <Composer.Input />
  <Composer.Submit />
</Composer.Root>
```

Use `Message.Markdown` when text parts should render GitHub-flavored Markdown; pass `components` to
replace code blocks or other Markdown elements with app-owned components.
