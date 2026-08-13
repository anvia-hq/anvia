---
"@anvia/core": minor
"@anvia/logger": patch
---

Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
to agent responses and observer starts, remove the prompt-request API and request subpath, remove
singular builder registrations, and remove agent event stores in favor of observability integrations.
