# @anvia/cli

Install editable, app-owned UI components on top of the headless `@anvia/react-ui` primitives.

```sh
pnpm dlx @anvia/cli init vite
pnpm dlx @anvia/cli add chat
```

`init` configures shadcn in an existing Next.js or Vite application. It does not create an app.
`add` writes components below the `components` alias from `components.json` (normally
`src/components/anvia`) and installs the matching `@anvia/react-ui` release.

Available items: `chat`, `thread`, `message`, `composer`, `attachment`, `markdown`, and
`tool-fallback`.

## Updating installed components

`update` compares the Anvia components in your project against the current registry:

```sh
pnpm dlx @anvia/cli update            # check every item (preview only, writes nothing)
pnpm dlx @anvia/cli update composer   # check a single item
pnpm dlx @anvia/cli update --overwrite
```

Without `--overwrite`, `update` is a preview: it reports each file as `up-to-date`,
`modified` (the installed copy differs from the registry), or `missing`. Pass `--overwrite`
to write the registry content over out-of-date and missing files of installed components.
`update` never installs new items — use `add` for that. Locally edited copies are
overwritten, so commit or stash your changes first.

## Agent Skills

Scaffold the Anvia Agent Skills into an application so agents can load them with
`loadSkills(skill.local("./skills"))`:

```sh
pnpm dlx @anvia/cli skills list                          # show the available skills
pnpm dlx @anvia/cli skills init                          # copy every skill into ./skills
pnpm dlx @anvia/cli skills init --claude --agents        # also wire Claude Code and AGENTS.md
pnpm dlx @anvia/cli skills init --codex --cursor         # --codex is an AGENTS.md alias
pnpm dlx @anvia/cli skills update                        # compare installed skills (preview only)
pnpm dlx @anvia/cli skills update --force
```

`skills init` always writes the canonical skills into `./skills` (override with
`--dir <path>`) — one folder per skill (`SKILL.md` + `references/` + `scripts/`), with
the executable bit preserved on skill scripts — and prints the wiring snippet. Generated
adapters and the snippet always reference the effective directory. The
target flags add adapters on top:

- `--claude` copies the skills into `.claude/skills/`, where Claude Code loads them natively.
- `--cursor` writes one on-demand Cursor rule per skill into `.cursor/rules/` that points
  at the matching `skills/<name>/SKILL.md`.
- `--agents` (and its alias `--codex`) maintains an `AGENTS.md` section, between
  `anvia-skills` markers, listing every skill with its description. Existing
  `AGENTS.md` content outside the markers is never touched.

Skills you have locally edited are left alone unless you pass `--force`. `skills update`
refreshes installed skills and adapters in place and never reinstalls skills that were
removed from the project. Both commands accept `--cwd <path>`.
