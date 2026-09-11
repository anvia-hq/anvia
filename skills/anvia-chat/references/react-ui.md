# React and UI

## Controllers (`@anvia/react`)

`useChat` and `useCompletion` require an explicit transport boundary:

```ts
useChat({ transport });
useChat({
  transport: createDirectClientTransport({
    handler: ({ request, abortSignal }) => handleChat({ request, abortSignal }),
  }),
});
```

`useChat`:

- Consumes only framed `ClientStreamFrame` values.
- Status: `ready | submitted | streaming | waiting | error`.
- Keeps readonly `UIMessage[]` locally; sends core `Message[]` in
  `ClientStreamRequest`.
- Exposes canonical events via `onEvent` and the returned `events` array.
- Exposes aggregate latest-run usage via `runUsage`; each assistant message
  keeps its own provider-generation usage.
- Actions: `sendMessage` (accepts attachments and metadata), `regenerate`,
  `stop`, `reset`, `setMessages`, `resume()`. State also exposes `suggestions`,
  `contextUsage`, `text`, and `streamId`. Submit through `sendMessage` rather
  than mutating `messages`.
- Supports resumable streams (`resume: { key }`, paired with the server's
  resumable response) and unified Agent interaction state.

When `chat.status === "waiting"`, render `chat.interactions.pending` and resume
through the same transport boundary:

```ts
await chat.respondToInteraction({
  interactionId,
  response: { type: "tool-approval", approved: true },
});
```

Render those prompts with `HumanInputPrimitive`, or drive them headlessly with
`useApproval` / `useQuestion` — both from `@anvia/react-ui`.

`useCompletion({ transport })` is single-turn: `complete({ prompt })` or manage
`input` and call `submit()`. Each call replaces the previous completion, events,
and usage — it never accumulates messages. The UI counterpart is
`CompletionProvider` + `CompletionPrimitive`.

`useSmoothStreamText` / `useSmoothStreamItems` only smooth presentation. They do
not change protocol events or message state.

## Headless primitives (`@anvia/react-ui`)

Primitives are headless: no stylesheet, style via `className` or `asChild`.
The DOM contract is ARIA attributes plus `data-state` / `data-role`.

- Keep `useChat` as the owner of transport and `UIMessage[]` state; wrap it with
  `ChatProvider` and render `ThreadPrimitive` / `MessagePrimitive` /
  `ComposerPrimitive`.
- Control `ComposerPrimitive.Root` with `input` / `attachments` props when
  needed; use `submitMessage` for custom payloads. `keepMounted` keeps empty
  wrappers for layout.
- `ComposerPrimitive.Input` is Tiptap-backed. Configure `Root` with `triggers`
  for inline `@` / `/` / `$` entity chips; selections submit under
  `metadata.composer.entities`. Entity `data` must be finite strict JSON (no
  class instances, cycles, accessors, symbols, `undefined`, non-finite numbers).
  Use `ComposerPrimitive.TextareaInput` for plain textarea behavior.
- Streaming reveal is opt-in and display-only. Keep the lifecycle mounted after
  streaming stops so the buffered tail drains; `MessagePrimitive.Parts` holds
  later tool parts behind unrevealed text:

```tsx
<MessagePrimitive.Parts
  stream={{
    isStreaming:
      chat.status === "streaming" &&
      message.role === "assistant" &&
      chat.messages.at(-1)?.id === message.id,
    resetKey: message.id,
    flushImmediately: chat.status === "error",
  }}
>
  {(part) => (part.type === "text" ? <MessagePrimitive.Markdown /> : <MessagePrimitive.Part />)}
</MessagePrimitive.Parts>
```

- For app-owned text state, `StreamMarkdown` from `@anvia/react-ui/stream` is a
  context-free renderer: pass displayed text as `content`, set `live` only for
  the growing tail, and style `[data-state="revealing"]` in the app.

## Editable components (`@anvia/cli`)

For styled, app-owned components instead of headless composition:

```sh
pnpm dlx @anvia/cli add chat
```

Items: `chat`, `thread`, `message`, `composer`, `attachment`, `markdown`,
`tool-fallback`. `add` writes below the `components` alias (normally
`src/components/anvia`) and installs the matching `@anvia/react-ui` release.
`@anvia/cli` installs the `[data-state="revealing"]` animation with the
`markdown`, `message`, `thread`, and `chat` items.
