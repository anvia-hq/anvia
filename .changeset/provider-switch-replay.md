---
"@anvia/anthropic": patch
"@anvia/openai": patch
"@anvia/gemini": patch
"@anvia/studio": patch
---

Fix failures when a conversation continues on another model provider.

- Anthropic: reasoning produced by another provider is no longer replayed. Only signed thinking from Anthropic (or history with unknown origin) is sent, so OpenAI summaries, unsigned text and Gemini thought signatures no longer reach Anthropic as `thinking` blocks. Assistant turns left empty are omitted, and tool-call ids are made unique within a request.
- Gemini: thought signatures from another provider are no longer sent as `thoughtSignature`.
- OpenAI Responses (and Azure, which uses it): a tool call's `id` is left out when the turn came from another provider, such as Anthropic (`toolu_...`). `call_id` still links the result.
- Studio: controls remembered from an earlier turn are kept only if the newly selected model offers them, so switching to a model without that control no longer fails with HTTP 400.
