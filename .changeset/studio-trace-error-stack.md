---
"@anvia/studio": patch
---

Stop persisting stack traces in Studio trace error payloads. Trace observations and run errors were serialized with `serializeUnknown`, which keeps `error.stack`; they now use the stack-free `serializeError` helper, so persisted traces and trace API responses contain only the error name and message.
