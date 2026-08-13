---
"@anvia/core": minor
"@anvia/logger": patch
---

Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
to agent responses and observer starts, remove the prompt-request API and request subpath, remove
singular builder registrations, and remove agent event stores in favor of observability integrations.
Unify direct model calls around input-first completion, image, speech, and transcription functions,
share retry options across agents and model calls, internalize request builders, and rename the
pipeline agent stage to `agent()`. Rename `createTool()` schema options from `input` and `output` to
`inputSchema` and `outputSchema`.
