---
"@anvia/core": patch
"@anvia/logger": patch
"@anvia/openai": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
"@anvia/grok": patch
"@anvia/client": patch
"@anvia/react-ui": patch
---

Classify malformed provider tool arguments as typed retryable output failures, validate all tool
calls before execution, preserve failed-attempt usage without exposing raw arguments, and reject
truncated, filtered, incomplete, ambiguous, or non-JSON tool-call responses across first-party
providers. Reject blank tool arguments and non-JSON provider options instead of inventing or
coercing values. Align `JsonObject` with runtime validation by excluding explicit `undefined`
properties while accepting immutable JSON arrays. Apply the same strict provider-options boundary
to completion, image, speech, and transcription calls. Require finite strict JSON for eval inputs
and parsed results instead of coercing them. Keep streaming retries disabled after observable
provider progress.
Validate React composer entity data as finite strict JSON at trigger, submission, and message
rendering boundaries.
Require MCP tool arguments to be strict JSON objects; only an explicit `undefined` direct call
omits the remote arguments field.
Make client tool-part states exact: completed results retain their original input, impossible state
combinations are rejected, and partial streamed arguments can never be replayed as model input.
