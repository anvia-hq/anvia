---
"@anvia/client": patch
"@anvia/react": patch
---

Hydrate persisted assistant usage, context usage, and sources into replayed UI messages while keeping
per-generation usage separate from aggregate run usage. Keep latest-context state aligned when a
new response omits context information. Expose the latest aggregate run usage as
`useChat().runUsage` and completion usage as `useCompletion().usage`.
