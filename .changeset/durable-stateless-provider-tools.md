---
"@anvia/durable": minor
---

Admit provider-executed tools, experimental. Set `providerTools: { mode: "stateless" }` on a registration to admit the agent's `ProviderTool` entries; the provider must keep no state between calls. The definitions are part of the persisted model request, so a changed definition under the same version fails replay with `needs_attention`, and a restart reuses the persisted provider response. A provider tool whose configuration is not JSON is rejected at registration. Without the marker, provider tools are still rejected at registration, and the error names the marker.
