# @anvia/cli

## 1.3.0

### Minor Changes

- f7e754b: Add `anvia skills init|update|list`: scaffold the Anvia Agent Skills — `SKILL.md` +
  `references/` + `scripts/` folders of verified Anvia-building knowledge (agents, chat,
  RAG, MCP, pipelines, Studio, evals, channels) — into an app's `./skills` folder so the
  developer's coding agent writes correct Anvia code. `skills update` refreshes installed
  skills behind the same preview-then-`--force` contract as component `update`;
  `skills list` shows the bundled skills. Skill scripts keep their executable bit.

  Target flags deliver the knowledge to the developer's agent: `--claude` copies the
  skills into `.claude/skills/` for native Claude Code loading, `--cursor` writes
  on-demand `.cursor/rules/` pointers per skill, and `--agents` (alias `--codex`)
  maintains a marker-managed `AGENTS.md` section listing every skill.

## 1.2.0

### Minor Changes

- 3f71955: Add `anvia update` command that compares installed Anvia UI components against the current
  registry. It previews out-of-date, modified, and missing files by default and writes updates
  to installed components with `--overwrite` (it never installs new items; use `add`). Also adds `closestRegistryItemName`, `inspectInstalledItems`, and
  `updateInstalledItems` exports with did-you-mean suggestions for unknown item names.

## 1.1.1

### Patch Changes

- f48bb95: Bump upstream runtime dependencies to their latest versions and align zod to 4.5.4 across all packages and workspaces.

## 1.0.2

## 1.0.1

## 1.0.0

### Patch Changes

- 07a1e6c: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.

## 1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- 928315b: Make React UI a strictly headless behavior layer with explicit `*Primitive` namespaces and a small
  ARIA, `data-state`, and `data-role` DOM contract. Add `@anvia/cli` to install editable Tailwind and
  shadcn-based chat components into applications, and move Studio's stream reveal styling into Studio.
