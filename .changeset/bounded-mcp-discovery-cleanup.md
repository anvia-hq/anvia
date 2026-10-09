---
"@anvia/mcp": patch
---

Close retained transports when discovery is cancelled during protocol negotiation, before the SDK
attaches the transport. Add opt-in `transport.terminateSessionOnClose` for best-effort legacy
session DELETE with a two-second cleanup bound, including failed initialization and cancellation.
Persistent sessions retain their existing behavior by default.

Add `tools.discoveryLimits: { maxTools, maxBytes }` to check cumulative tool counts and UTF-8
serialized tool-page bytes before SDK aggregation. Reject the first over-budget page without
fetching later pages; retrying discovery starts a fresh budget.
