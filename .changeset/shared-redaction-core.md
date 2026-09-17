---
"@anvia/core": minor
"@anvia/lens": minor
"@anvia/langfuse": minor
---

Share one PII redactor across the observability adapters.

`@anvia/core/redaction` now owns the redaction implementation and its default patterns, and
`@anvia/lens` and `@anvia/langfuse` re-export it through their existing `createLensRedactor` and
`createPiiRedactor` APIs. A pattern or traversal fix only has to land once instead of twice.

Behavior that comes with the shared implementation:

- Card matches no longer consume a trailing separator, so `card 4111-1111-1111-1111 today` keeps its
  spacing.
- Card matches require an issuer prefix and a valid Luhn checksum, and phone matches are skipped when
  they are part of a longer grouped digit run, so `1234 5678 9012 3456` survives untouched.
- Numeric values are inspected only by patterns that opt in (`numeric: true`, the card pattern), and
  a matched number becomes the replacement text.
- Values nested deeper than 16 levels become `<max-depth>` instead of being exported unredacted, and
  circular references become `<circular>`.
- Every adapter gains the `bearer` pattern and the wider `sk-`/`pk-`/`api-`/`key-`/`token-` key
  prefixes. `@anvia/langfuse` replacement text stays `[REDACTED]` and `@anvia/lens` stays
  `<redacted>`.
