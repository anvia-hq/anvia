---
"@anvia/core": minor
"@anvia/logger": patch
---

Expose `new Agent(options)` with direct `generate()` and steerable `stream()` execution, add run IDs
to agent responses and observer starts, remove the prompt-request API and request subpath, remove
singular builder registrations, and remove agent event stores in favor of observability integrations.
Unify direct model calls around input-first completion, image, speech, and transcription functions,
share retry options across agents and model calls, internalize request builders, and rename the
pipeline agent stage to `agent()`. Rename `createTool()` schema options from `input` and `output` to
`inputSchema` and `outputSchema`. Remove `ToolSet`, `AgentBuilder.useToolSet()`, and dynamic/provider
tool registration methods in favor of a single `tools` option that accepts executable tools,
provider-native tools, and tool indexes. Move dynamic tool selection settings onto
`createToolIndex()` and expose each agent's executable inventory through readonly `agent.tools`.
