# @anvia/cli

Install Anvia Agent Skills for a coding agent and editable React UI components for an application.
Requires Node.js 20.18.1 or newer.

The grouped UI commands and `--apply` below are pending the next CLI release. Published CLI
1.3.0 uses the root `init`, `add`, and `update` commands and the legacy update flags.

## Commands

```sh
anvia ui init [next|vite]
anvia ui add <item>
anvia ui update [items...]          # preview only
anvia ui update [items...] --apply

anvia skills list
anvia skills init
anvia skills update                # preview only
anvia skills update --apply
```

UI commands belong under `ui`; agent knowledge belongs under `skills`. Both update commands
preview changes without writing files. `--apply` explicitly writes them, replacing differing
files rather than merging local changes. Review the preview before applying it.

Run `anvia --help`, `anvia ui --help`, or `anvia skills --help` for options. Unknown commands
and options fail with exit code 1. There is no `--dry-run` flag; updates already preview by default.

Compatibility aliases remain supported:

| Legacy                        | Preferred                     |
| ----------------------------- | ----------------------------- |
| `anvia init`                  | `anvia ui init`               |
| `anvia add`                   | `anvia ui add`                |
| `anvia update`                | `anvia ui update`             |
| `anvia update --overwrite`    | `anvia ui update --apply`     |
| `anvia skills update --force` | `anvia skills update --apply` |

`ui init --force`, `ui add --overwrite`, and `skills init --force` retain their existing meanings.

## Editable UI components

`ui init` configures shadcn in an existing Next.js or Vite app; it does not create an app.
`ui add` writes below the components alias in `components.json` (normally
`src/components/anvia`) and installs the React UI version recorded with the bundled registry.
The CLI and React UI release independently.

Available items: `chat`, `thread`, `message`, `composer`, `attachment`, `markdown`, and
`tool-fallback`. Larger items include their shared component dependencies.

```sh
anvia ui init vite --cwd ./my-app
anvia ui add chat --cwd ./my-app
anvia ui update composer --cwd ./my-app
anvia ui update composer --cwd ./my-app --apply
```

Updates compare installed files against the bundled registry and report `up-to-date`, `modified`,
or `missing`. An item counts as installed if any file in its dependency set exists. Shared files
can therefore make larger items count as incomplete installations. Name the items you intend to
update; an unrestricted applied update can fill those larger compositions. Shared paths are
written once. Updates do not run shadcn, upgrade dependencies, refresh CSS, or delete obsolete files.

## Agent Skills

Skills bundle API-verified knowledge for agents, chat, RAG, MCP, pipelines, Studio, evals,
and channels. Installation copies `SKILL.md`, `references/`, and `scripts/`; it does not run scripts.

```sh
anvia skills list
anvia skills init --claude --codex --cursor
anvia skills update --claude --codex --cursor
anvia skills update --claude --codex --cursor --apply
```

`skills init` always creates the canonical `./skills/<name>/` trees (override with `--dir <path>`),
copying the bundled file permissions. Differing existing files are preserved unless `--force`
is supplied. Target flags add integrations:

- `--claude`: self-contained copies in `.claude/skills/`.
- `--cursor`: on-demand `.cursor/rules/<name>.mdc` pointers into the canonical directory.
- `--agents` or `--codex`: an Anvia section in `AGENTS.md`, preserving instructions outside its markers.

Repeat target flags and directory options during updates. All selected targets, including
AGENTS.md, are read-only during preview and list paths that would change. Applied updates replace
differing files and restore missing files inside installed skill trees. Fully removed skills are
not reinstalled by updates; use `skills init` to restore them. Cursor rules and AGENTS.md pointers
are generated for every bundled skill and can reference a removed canonical directory.

Both UI and skill commands accept `--cwd <path>` except `skills list`, which only lists bundled names.
The public update APIs also accept `apply: true`, retaining `overwrite` and `force` compatibility options.
Skill target reports include `pending` paths during preview; `created` and `updated` contain actual writes.

## Try the development build

From the Anvia repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @anvia/cli... build
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js skills update --cwd /path/to/project --codex
```

The examples above use `anvia` as shorthand for the installed binary or this built entrypoint.
