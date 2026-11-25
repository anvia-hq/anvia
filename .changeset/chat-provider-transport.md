---
"@anvia/react": minor
---

`ChatProvider` now accepts `transport` (plus any other `useChat` option) and creates the chat itself, so the common case no longer needs a separate `useChat` call. Passing `controller` works exactly as before; read the controller from `useChatContext()` when you need it.
