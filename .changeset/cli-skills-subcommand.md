---
"@anvia/cli": minor
---

Add `anvia skills init|update|list`: scaffold the Anvia Agent Skills — `SKILL.md` +
`references/` + `scripts/` folders of verified Anvia-building knowledge (agents, chat,
RAG, MCP, pipelines, Studio, evals, channels) — into an app's `./skills` folder so the
developer's coding agent writes correct Anvia code. `skills update` refreshes installed
skills behind the same preview-then-`--force` contract as component `update`;
`skills list` shows the bundled skills. Skill scripts keep their executable bit.

Target flags deliver the knowledge to the developer's agent: `--claude` copies the
skills into `.claude/skills/` for native Claude Code loading, `--cursor` writes
on-demand `.cursor/rules/` pointers per skill, and `--agents` (alias `--codex`)
maintains a marker-managed `AGENTS.md` section listing every skill. Apps that also
embed an Anvia Agent can load the same folder at runtime with
`loadSkills(skill.local("./skills"))`.
