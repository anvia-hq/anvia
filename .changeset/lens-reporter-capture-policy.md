---
"@anvia/lens": minor
---

Apply the client capture policy to eval reporters and validate Lens base URLs eagerly.

`lens.evalReporter()` now inherits the client-level `redactInputs`, `redactOutputs`, `redaction`,
and `captureMaxBytes` settings, and accepts those fields as per-reporter overrides. Eval payloads
are redacted before serialization and bounded by `captureMaxBytes`; payloads over the limit are
recorded as `anvia.eval.payload.status: "size_limit"` instead of being exported. Byte limits that are
not integers of at least 96 bytes are rejected when the observer or reporter is created, since
OpenTelemetry treats those values as unbounded.

`baseUrl` must now be an absolute `http`/`https` URL without query or fragment, including a trailing
empty `?` or `#`. Malformed values throw a `TypeError` when the client, prompt client, or dataset
client is created rather than failing on the first request or, for OTLP exports, silently at export
time.
