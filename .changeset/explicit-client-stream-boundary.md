---
"@anvia/client": patch
"@anvia/core": patch
"@anvia/server": patch
"@anvia/react": patch
"@anvia/react-ui": patch
"@anvia/studio": patch
---

Add a framework-neutral, runtime-validated client stream protocol with explicit completion and Agent
adapters, lossless Message/UIMessage conversion, automatic tool-call deltas, masked client errors,
typed data events, HTTP and direct transports, and always-framed resumable streams. Remove Core's UI
message surface and the ambiguous Server and React event-stream APIs. Require React hooks to use an
endpoint or canonical transport, expose four-state request lifecycle status, and migrate Studio to
the same explicit boundary.
