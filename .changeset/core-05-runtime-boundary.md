---
"@anvia/core": minor
---

Add opt-in Anvia terminal-error serialization to `toReadableStream`. Preserve safe diagnostics and valid usage without exposing stack, cause, arbitrary details, or raw provider payloads. Keep generic JSONL serialization unchanged by default, and finish terminal or cancelled iterators once.

Omit terminal usage when any token counter or usage detail is negative or non-finite.
