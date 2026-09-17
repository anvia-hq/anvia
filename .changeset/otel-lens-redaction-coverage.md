---
"@anvia/otel": minor
"@anvia/lens": minor
---

Redact error text and metadata surfaces.

`@anvia/otel` gains `transformError` and `transformMetadata` hooks. Error messages, span status
messages, and recorded exception messages and stack traces run through `transformError`; trace
metadata, run event attributes, tool metadata, score metadata, and evaluation metadata run through
`transformMetadata`. A `transformMetadata` that does not return a record drops the surface instead
of exporting it unredacted. Both hooks default to the previous pass-through behavior.

`@anvia/lens` exposes `redactErrors` and `redactMetadata` for those surfaces, on the client and per
observer or reporter, so redaction no longer stops at captured bodies. Error text is captured output
and metadata is captured input, so `redactErrors` follows `redactOutputs` and `redactMetadata`
follows `redactInputs` unless either is set explicitly.
