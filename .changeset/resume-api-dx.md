---
"@anvia/core": minor
"@anvia/server": minor
"@anvia/react": patch
---

Add first-class stream resume to the shared request and response APIs.

`UIStreamRequest` now includes optional `resume: { streamId, after }`. `@anvia/server` adds a
`createEventStream({ resume })` / `createUIStreamResponse({ resume })` overload so routes can
continue in-flight streams without manually composing `resumeStreamEvents`.
