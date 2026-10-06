# @anvia/cli

Add Anvia to your development workflow: install Agent Skills for your coding agent, or copy editable
React UI components into your application.

Requires Node.js 20.18.1 or newer.

## Quickstart

Run directly with pnpm:

```sh
pnpm dlx @anvia/cli skills init --codex
```

This creates local `skills/` trees and adds references to `AGENTS.md`. Choose `--claude`, `--cursor`,
or multiple target flags to integrate with other coding agents. Skills cover agents, chat, RAG, MCP,
pipelines, Studio, evaluations, channels, and experimental durable workflows.

## Add UI components

In an existing Next.js or Vite application:

```sh
pnpm dlx @anvia/cli ui init vite
pnpm dlx @anvia/cli ui add chat
```

Use `ui init next` for Next.js. Initialization configures shadcn in your existing app; `ui add`
installs the required dependencies and writes editable components beneath your configured components
alias. Available items include `chat`, `thread`, `message`, `composer`, `attachment`, `markdown`,
and `tool-fallback`.

## Preview and apply updates

```sh
pnpm dlx @anvia/cli ui update chat
pnpm dlx @anvia/cli ui update chat --apply

pnpm dlx @anvia/cli skills update --codex
pnpm dlx @anvia/cli skills update --codex --apply
```

Updates preview changes by default. `--apply` replaces differing files, including local edits, so
review the preview first. Repeat your skill target flags when updating. UI updates replace component
files; they do not upgrade dependencies or refresh CSS.

## Install locally

```sh
pnpm add -D @anvia/cli
pnpm exec anvia --help
```

Use `--cwd <path>` to target another project. `skills list` shows the bundled skills. Root-level
`init`, `add`, and `update` commands remain supported as compatibility aliases for `ui` commands.

## Learn more

- [CLI commands and update behavior](https://github.com/anvia-hq/anvia/blob/main/docs/packages/cli.md)
- [Headless React UI](https://github.com/anvia-hq/anvia/tree/main/packages/react-ui#readme)
- [Bundled Agent Skills](https://github.com/anvia-hq/anvia/tree/main/skills)
