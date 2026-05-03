#!/bin/sh
changes="$1"

printf 'Summary: Anvia gained new agent-building capabilities.\n\n'
printf -- '- Skills: local skill folders can provide instructions, references, and scripts.\n'
printf -- '- Tools: MCP, streaming, and structured tool flows are easier to compose.\n'
printf -- '- Attachments: image and PDF inputs can be passed through supported providers.\n'
printf '\nSource changes: %s\n' "$changes"
