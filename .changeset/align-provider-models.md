---
"@anvia/anthropic": minor
"@anvia/gemini": minor
"@anvia/grok": minor
"@anvia/jev": minor
"@anvia/mistral": minor
"@anvia/openai": minor
---

Align provider model ID types, context limits, and reasoning-effort controls with the latest vendor model lineups:

- `@anvia/anthropic`: add `claude-fable-5-1`, `claude-fable-5-2`, `claude-mythos-5-1`, `claude-mythos-5-2`, `claude-haiku-5-5`, `claude-sonnet-5-5`, and `claude-opus-5-5` with 1M/128K context limits and effort controls.
- `@anvia/openai`: add GPT-6/6.1/6.2 (`gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6.2-astra`, `gpt-6.2-astra-law`, `gpt-6.2-sol`, `gpt-5.6-cyber`, `gpt-6-cyber`, `gpt-6-rosalind`, `gpt-rosalind-research`, `gpt-daybreak-blue-latest`, `gpt-daybreak-red-latest`) and GPT-Image 2.5/2.6 (`gpt-image-2.5-*`, `gpt-image-2.6-*`) model IDs, context limits, and reasoning-effort controls.
- `@anvia/gemini`: add `gemini-3.8-flash`, `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`, and `gemini-4-neon`, plus `"xhigh"` thinking level support for `gemini-4-hydrogen` and `gemini-4-neon`.
- `@anvia/grok`: add `GROK_4_7`, `grok-4.7`, and `grok-4.7-latest` with 500K context limits and `["low", "medium", "high", "xhigh"]` reasoning controls.
- `@anvia/mistral`: add `mistral-large-4` and `mistral-large-4-0` with 1M context / 256K output limits.
- `@anvia/jev`: add `JEV_PREVIEW` (`"jev-preview"`) to known decision model IDs.
