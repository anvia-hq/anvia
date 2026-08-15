---
"@anvia/core": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/grok": patch
"@anvia/langfuse": patch
"@anvia/logger": patch
"@anvia/mistral": patch
"@anvia/openai": patch
"@anvia/otel": patch
"@anvia/react": patch
"@anvia/studio": patch
---

Finalize the 1.0 generation API around `generateCompletion`, `streamCompletion`, `generateImage`,
`generateSpeech`, and `transcribe`, with one options object, `prompt` or `messages` completion
input, schema-backed typed output, normalized result shapes, `providerOptions`, shared retries, and
end-to-end cancellation. Move Agent retry defaults to Agent construction with explicit per-run
inherit, disable, and replace behavior; make tool-call deltas automatic; nest stream terminal data
under `final.result`; expose blocked and typed Agent results consistently through tools, pipelines,
observers, React, and Studio; and rename audio-generation contracts to speech-generation.
