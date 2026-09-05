---
"@anvia/tool-studio": patch
---

Omit stack traces from tool run error responses. Tool failures reported by
`POST /agents/:agentId/tools/:toolName/runs` now serialize errors with the same
safe serializer used by agent and pipeline run failures, keeping the error name
and message while dropping stack traces.
