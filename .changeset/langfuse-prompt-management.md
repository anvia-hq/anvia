---
"@anvia/langfuse": minor
---

Add a Langfuse prompt client and prompt-attribute binding on
traces and generations.

`createLangfusePromptClient(tracing, options)` exposes four
methods:

- `getPrompt(name, { version?, label?, cacheTtlMs?, refresh? })`
  GETs `/api/public/v2/prompts/:name` and returns a parsed
  `LangfusePrompt` (text or chat). Responses are cached in
  memory for `cacheTtlMs` (default 60 s), keyed by
  `name::version::label`.
- `getPromptText(name, options?)` projects the prompt string.
- `getPromptChat(name, options?)` projects the chat message
  array.
- `refresh()` clears the cache.

The langfuse tracing instance now reads the prompt ref from
`args.promptRef` (typed) or `args.trace.metadata.promptName` /
`promptVersion` (string-keyed fallback) on `startRun`, and
attaches `langfuse.trace.metadata.promptName` /
`langfuse.trace.metadata.promptVersion` to the root and to each
generation in the run.

Auth uses the same `LANGFUSE_PUBLIC_KEY` /
`LANGFUSE_SECRET_KEY` env vars and base URL as
`langfuse.create()`. Per-request timeout defaults to 30
seconds, configurable via `options.timeoutMs`.
