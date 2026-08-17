---
"@anvia/core": patch
---

Allow applications to explicitly disable Streamable HTTP SSRF protection for trusted local or
private-network MCP servers while retaining strict public-only validation by default. Replace the
arbitrary `requestInit` escape hatch with strictly validated string `headers` scoped to the exact MCP
endpoint while keeping protocol-owned request fields and OAuth traffic isolated.
