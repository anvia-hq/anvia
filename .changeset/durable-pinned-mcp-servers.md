---
"@anvia/durable": minor
---

Admit MCP servers behind an explicit marker (parity phase 6).

- Registration accepts `mcpServers: { mode: "pinned" }`. Without it, MCP servers are still rejected,
  and the error names the marker.
- The run stores a fingerprint of each server (name, server info, capabilities, instructions, and
  each tool's names and definition) at submission. A changed tool list under the same registration
  version fails the run with `needs_attention` before any model call.
- Each MCP call is an ordinary tool operation with the registration's `toolRecovery` policy (default
  `manual`). An interrupted call blocks for reconciliation.
- Discovery stays in the application (`McpClient.connect()`); durable does not call `listTools`.
- Pinned agents are registered in `DurableRuntime.open()`, which computes their fingerprint before any
  run starts. `registerAgents()` rejects a pinned agent, because the fingerprint reads tool definitions
  that may be asynchronous. Owned agent task children and graph tasks record the same fingerprint.
