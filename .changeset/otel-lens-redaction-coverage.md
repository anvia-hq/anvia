---
"@anvia/otel": minor
"@anvia/lens": minor
---

Redact error text and metadata, and tighten the Lens PII redactor.

`@anvia/otel` gains `transformError` and `transformMetadata` hooks. Error messages, span status
messages, and recorded exception messages and stack traces run through `transformError`; trace
metadata, run event attributes, tool metadata, score metadata, and evaluation metadata run through
`transformMetadata`. A `transformMetadata` that does not return a record drops the surface instead
of exporting it unredacted. Both hooks default to the previous pass-through behavior.

`@anvia/lens` exposes `redactErrors` and `redactMetadata` for those surfaces, on the client and per
observer or reporter, so redaction no longer stops at captured bodies. Card matches now require an
issuer prefix and a Luhn checksum, so grouped numeric identifiers survive; numbers whose text
matches a pattern are redacted; traversal stops at 16 levels (`<max-depth>`) instead of walking
arbitrary model output; default patterns add IPv4, phone, and JWT coverage; and phone matches
require a `+` country code or a parenthesized area code. `LensRedactor` and `passesLuhn` are
exported for custom redaction patterns.
