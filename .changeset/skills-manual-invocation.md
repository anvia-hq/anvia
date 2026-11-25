---
"@anvia/cli": patch
---

Make the bundled `anvia-*` Agent Skills manual-only: `disable-model-invocation: true` in each `SKILL.md` (Claude Code) and `agents/openai.yaml` with `allow_implicit_invocation: false` (Codex). Invoke them explicitly with `/anvia-agent` or `$anvia-agent`.
