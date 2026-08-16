---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/studio": patch
"@anvia/logger": patch
"@anvia/langfuse": patch
"@anvia/lens": patch
"@anvia/otel": patch
---

Redesign observability around named Agent observers, explicit primary trace provenance, and
object-only eval targets and reporter error policies. Add owned, lazy, asynchronously disposable
Langfuse and Lens clients; make OpenTelemetry and logger observers lifecycle-free registrations;
and preserve observer identity through client streams and Studio traces.
Eval trace resolution now preserves observer provenance, and reporters reject traces owned by a
different backend unless explicitly mapped. Langfuse clients use isolated tracer providers, and
strict observer startup/terminal dispatch cleans up partial starts without duplicate terminal calls.
