---
"@anvia/cli": minor
---

Add `anvia skills init|update|list`. `skills init` copies the Anvia Agent Skills
(SKILL.md + references/ + scripts/ per skill) into an app's `./skills` folder for use
with `loadSkills(skill.local("./skills"))`; `skills update` refreshes installed skills
behind the same preview-then-`--force` contract as component `update`; `skills list`
shows the bundled skills. Skill scripts keep their executable bit.

Target flags add agent adapters on top of the `./skills` copy: `--claude` copies the
skills into `.claude/skills/` for native Claude Code loading, `--cursor` writes
on-demand `.cursor/rules/` pointers per skill, and `--agents` (alias `--codex`)
maintains a marker-managed `AGENTS.md` section listing every skill.
