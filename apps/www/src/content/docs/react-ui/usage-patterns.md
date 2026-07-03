---
title: Usage patterns
description: Common ways to compose @anvia/react-ui with @anvia/react and application-owned UI.
section: react-ui
sidebar:
  group: Start Here
  order: 3
  label: Usage patterns
---

## Pair it with @anvia/react

`@anvia/react-ui` expects controllers from `@anvia/react`.

- Use `useChat(...)` with `ChatProvider`, `Thread`, `Message`, `Composer`, and `HumanInput`.
- Use `useCompletion(...)` with `CompletionProvider` and `Completion`.
- Keep server routes, auth, persistence, and model selection outside the UI package.

```tsx
const chat = useChat({ endpoint: "/api/chat" });

return (
  <ChatProvider controller={chat}>
    <Thread.Root>
      <Thread.Viewport>
        <Thread.Messages />
      </Thread.Viewport>
      <Composer.Root>
        <Composer.Input />
        <Composer.Submit />
      </Composer.Root>
    </Thread.Root>
  </ChatProvider>
);
```

## Stay headless

Every primitive accepts regular element props such as `className`. Button-like primitives also
support `asChild`, so applications can attach Anvia behavior to design-system components.

```tsx
<Composer.Submit asChild>
  <IconButton aria-label="Send message" icon={<ArrowUpIcon />} />
</Composer.Submit>
```

Use `data-anvia-*` selectors when the styling should follow primitive state instead of component
names.

```css
[data-anvia-message][data-role="user"] {
  justify-items: end;
}

[data-anvia-submit][data-state="disabled"] {
  opacity: 0.5;
}
```

## Render streamed parts directly

`Message.Parts` renders Anvia `UIMessagePart` values by default. Use a child function to replace
only the parts that need product-specific UI.

```tsx
<Message.Parts>
  {(part) => {
    if (part.type === "tool") {
      return (
        <Message.Part>
          <Message.Tool>
            {(tool) => <ToolCallCard tool={tool} />}
          </Message.Tool>
        </Message.Part>
      );
    }

    if (part.type === "attachment") {
      return (
        <Message.Part>
          <Message.Attachment className="attachment-preview" />
        </Message.Part>
      );
    }

    return <Message.Part />;
  }}
</Message.Parts>
```

## Attach files in the composer

`Composer.AddAttachment` opens a file picker, `Composer.AttachmentInput` gives direct access to the
underlying input, `Composer.AttachmentDropzone` accepts dropped files, and `Composer.Attachments`
renders pending attachments before the prompt is sent.

```tsx
<Composer.Root>
  <Composer.AttachmentDropzone className="dropzone">
    <Composer.Attachments className="attachment-list" />
    <Composer.AddAttachment accept="image/*,.pdf" multiple>
      Attach
    </Composer.AddAttachment>
    <Composer.Input minRows={1} maxRows={6} />
    <Composer.Submit />
  </Composer.AttachmentDropzone>
</Composer.Root>
```

## Control composer state

Keep the composer uncontrolled for simple chat surfaces. Use controlled props when the draft or
pending attachments need to sync with application state.

```tsx
const [draft, setDraft] = useState("");
const [attachments, setAttachments] = useState<UIAttachment[]>([]);

return (
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
);
```

## Control empty wrappers

Some collection primitives unmount when empty so they do not create layout gaps. Use `keepMounted`
when your app CSS needs a stable wrapper.

```tsx
<Thread.Messages keepMounted={false} />
<Thread.Suggestions keepMounted />
<Composer.Attachments keepMounted />
<HumanInput.Approvals keepMounted />
<HumanInput.Questions keepMounted />
```

## Split default and custom rendering

You can mix default primitives and custom product components. A common pattern is to keep
`Message.Part` as the fallback and specialize only expensive or domain-specific parts.

```tsx
<Message.Parts filter={(part) => part.type !== "reasoning"}>
  {(part) => {
    if (part.type === "tool" && part.toolName === "searchDocs") {
      return <SearchResultTool part={part} />;
    }

    return <Message.Part />;
  }}
</Message.Parts>
```
