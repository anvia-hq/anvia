# AGENTS.md

Guidance for coding agents working in this repository.

## Project Shape

Anvia is a TypeScript pnpm workspace for provider-agnostic AI runtime primitives,
provider adapters, vector stores, observability integrations, Studio, and examples.

Workspace packages are declared in `pnpm-workspace.yaml`:

- `packages/*`
- `examples/*`

Use `pnpm` from the repository root. The repo declares `pnpm@11.0.4`.

## Before Editing

- Check `git status --short --branch` before making changes.
- Read the package or example files you are about to change; follow local patterns.
- Do not edit `dist/`, coverage output, `node_modules/`, or other build artifacts by hand.
- Keep changes scoped. Avoid mixing dependency updates, generated artifact churn,
  formatting-only changes, and feature work unless they are required for the same
  change.
- Never commit secrets, API keys, private prompts, customer data, credentials,
  or trace payloads.

## Common Commands

Run from the repository root:

```sh
pnpm install
pnpm check
pnpm check:fix
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

Prefer package-scoped commands while iterating:

```sh
pnpm --filter @anvia/core typecheck
pnpm --filter @anvia/core test
pnpm --filter @anvia/core build

pnpm --filter @anvia/openai typecheck
pnpm --filter @anvia/openai test

pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build
```

CI builds `@anvia/core` first, then the remaining packages:

```sh
pnpm --filter @anvia/core build
pnpm --filter './packages/**' --filter '!@anvia/core' build
pnpm --filter './packages/**' typecheck
pnpm --filter './packages/**' test
```

## Formatting And Style

- TypeScript is strict, ESM, target `ES2022`, with `moduleResolution: "Bundler"`.
- Biome owns formatting and linting. Use repo scripts instead of ad hoc
  formatting.
- Biome uses 2-space indentation, double quotes, semicolons, trailing commas for
  JavaScript/TypeScript, and 100-column line width.
- Match each package's import specifier style. Some packages use extensionless
  local imports; many adapter packages use `.js` in source imports.
- Keep public APIs explicit and typed. Prefer runtime validation at tool,
  extraction, provider response, and external input boundaries.

## Package Boundaries

Package source lives in `src/`, tests usually live in `test/`, and build output
goes to `dist/`.

Most publishable packages expose `./dist/index.js` and `./dist/index.d.ts`.
`@anvia/core` has many subpath exports; when adding or moving a public entrypoint:

1. Add or update the source file.
2. Update the package `build` command if a new tsup entry is needed.
3. Update `exports` in the package `package.json`.
4. Update public re-exports from the relevant `src/index.ts` or subpath index.
5. Add or update tests.
6. Update package documentation and note any external documentation impact when public symbols
   change.

Keep provider-specific SDKs out of `@anvia/core`. Provider behavior belongs in
`packages/provider-*`; vector-store behavior belongs in `packages/vector-*`;
embedding adapter behavior belongs in `packages/embedding-*`; Studio runtime/UI
behavior belongs in `packages/tool-studio`.

## Package Map

- `packages/core`: core runtime for agents, completion, tools, hooks, request
  runtime, streaming, UI messages, extractors, pipelines, evals, embeddings,
  loaders, MCP, memory, model listing, observability, skills, transcription,
  audio/image generation, and vector-store contracts.
- `packages/provider-openai`, `packages/provider-anthropic`,
  `packages/provider-gemini`, `packages/provider-mistral`: provider adapters
  mapping Anvia completion/embedding/media contracts to vendor SDKs.
- `packages/vector-chroma`, `packages/vector-lancedb`,
  `packages/vector-milvus`, `packages/vector-pgvector`,
  `packages/vector-pinecone`, `packages/vector-qdrant`,
  `packages/vector-redis`, `packages/vector-weaviate`: vector store adapters.
- `packages/embedding-fastembed`, `packages/embedding-transformers`: local
  embedding adapters.
- `packages/observability-langfuse`, `packages/observability-otel`: tracing,
  eval reporting, scoring, prompt/dataset helpers, and OpenTelemetry adapters.
- `packages/logger`: console, pino, and observer logger helpers.
- `packages/react`: React hooks and transports for chat/completion UI streams.
- `packages/server`: JSONL, SSE, and UI stream response helpers.
- `packages/tool-sandbox`: Docker-backed sandbox tools. Docker integration tests
  are gated by `ANVIA_SANDBOX_DOCKER_TESTS=1`.
- `packages/tool-studio`: local Studio runtime, HTTP routes, storage, trace
  handling, and Vite/React UI. Its build compiles both the package and UI assets.

## Testing Notes

- Unit tests use Vitest.
- React tests use `happy-dom`.
- Studio tests exercise runtime routes, persistence, trace/session behavior, and
  UI helpers; use focused filters if the whole Studio suite is slow.
- Provider tests should mock or fake SDK behavior. Ordinary package tests should
  not require networked model providers or API keys.
- Docker sandbox integration tests are skipped unless
  `ANVIA_SANDBOX_DOCKER_TESTS=1` is set.

## Scripts

Root scripts in `scripts/` are release automation:

- `scripts/publish-packages.mjs`: packs and publishes non-private packages in
  dependency order, skips already-published versions, and creates local git tags
  unless `SKIP_GIT_TAGS=true` or `--skip-git-tags` is used.
- `scripts/prepare-preview-release.mjs`: rewrites package versions and internal
  dependency ranges to preview versions. Use `--dry-run` unless intentionally
  mutating manifests.
- `scripts/create-github-releases.mjs`: creates GitHub Releases for existing
  package tags. Requires `GITHUB_TOKEN` unless `--dry-run` is used.
- `scripts/notify-discord-release.mjs`: sends stable or preview release notes to
  Discord when `DISCORD_WEBHOOK_URL` is set.

Do not run publish, preview release, GitHub release, deploy, or Discord
notification commands unless explicitly requested.

Other maintenance:

- `bin/check-upstream-deps.sh`: reports npm updates for external runtime
  dependencies declared by `packages/*`. It supports `--filter`, `--json`,
  `--all`/`--dev`, and `--fail-on-update`.
- `examples/cookbook/skills/release-notes/scripts/draft.sh`: demo skill script
  used by cookbook content.

## Generated Files

Generated files include, but are not limited to:

- `dist/`
- `coverage/`

If a generator rewrites files unexpectedly, inspect the diff before continuing.

## Dependencies

- Use package-scoped `pnpm --filter ... add ...` commands for dependency changes.
- Keep local workspace dependencies using `workspace:*` where the repo already
  does.
- Keep related schema/SDK dependencies aligned across packages and examples,
  especially `zod`.
- After dependency changes, run relevant package checks and usually:

```sh
bin/check-upstream-deps.sh
pnpm typecheck
pnpm test
```

## Changesets And Releases

Changesets are configured in `.changeset/config.json`. The ignored workspaces are `cookbook` and
`anvia-cli-agent`.

For public package behavior changes, add or update a changeset unless the user
or maintainer explicitly says not to. Avoid versioning, publishing, creating
tags, or deployment commands unless explicitly requested.

### 1.0 RC Flow

1. Public API and fix PRs target `staging` and include a patch changeset.
2. First RC preparation only: run `pnpm rc:enter` in a release PR. This creates
   unpublished `1.0.0-rc.0`.
3. To cut a public RC, run `pnpm rc:version` in a release PR and merge it into
   `staging`.
4. Tag the exact merged commit and push the tag:

```sh
git tag v1.0.0-rc.N
git push origin v1.0.0-rc.N
```

The tag publishes all public packages together under the npm `rc` tag. Multiple
change PRs may be combined into one RC.

## Pull Request Expectations

Before handing work back, report:

- What changed.
- Which validation commands ran.
- Any validation that was skipped and why.
- Any generated files intentionally changed.

For visible Studio UI changes, include screenshots or note that no visual verification was run.
