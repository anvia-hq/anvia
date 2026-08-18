---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/react": patch
"@anvia/react-ui": patch
"@anvia/studio": patch
---

Move Agent interaction contracts and parsers to the browser-safe
`@anvia/core/agent/interactions` subpath. Prevent Client and React bundles from loading the Agent
runtime, MCP stdio, Node built-ins, or undici through Core's server barrels.
