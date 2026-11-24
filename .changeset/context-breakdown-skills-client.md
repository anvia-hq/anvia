---
"@anvia/core": minor
"@anvia/client": minor
"@anvia/react": minor
"@anvia/studio": patch
---

Add `skills` tracking to context breakdown and surface `contextBreakdown` end-to-end across Agent outcomes/streams, `@anvia/client`, `@anvia/react`, and `@anvia/studio`.

- `@anvia/core/context`: add the `skills` segment (combining skill catalog instructions, skill tool definitions, and loaded skill tool results) via `skillInstructions` and `skillToolNames`, export `CONTEXT_SEGMENT_IDS` and `isContextBreakdown`, auto-detect skills in `Agent`, and expose scaled `contextBreakdown` on `AgentOutcome`, streaming `turn_end` events, and assistant generation metadata.
- `@anvia/client`: forward and validate `contextBreakdown` on `message_end`, `turn_end`, `run_end`, and `UIMessage.generation` (including hydration via `messagesToUIMessages`).
- `@anvia/react`: expose `contextBreakdown` on `useChat` and pass optional `breakdown` through `ContextMeterPrimitive`'s render prop.
- `@anvia/studio`: add the `Skills` label and theme color to `ContextBreakdown`.
