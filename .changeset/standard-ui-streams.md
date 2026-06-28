---
"@anvia/core": minor
"@anvia/react": minor
"@anvia/server": minor
---

Add the shared UI message stream protocol for React-facing completions and agents.

`@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.
