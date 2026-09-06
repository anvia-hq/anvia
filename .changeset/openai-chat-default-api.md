---
"@anvia/openai": patch
"@anvia/grok": patch
---

`completionModel()` now defaults to the Chat Completions API. `api` is optional and falls back to `"chat"`; pass `api: "responses"` explicitly to keep using the Responses API. Grok server-side provider tools are only advertised on Responses handles.
