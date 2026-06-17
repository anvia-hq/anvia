# Development

This guide describes the local development workflow for Anvia.

## Requirements

- Node.js 20 or newer.
- pnpm 11.0.4, as declared by `packageManager` in `package.json`.
- Docker, only for cookbook examples that use local services such as ChromaDB.

Install dependencies from the repository root:

```sh
pnpm install
```

## Repository Layout

```txt
.
├── apps/
│   └── docs/                     # Documentation app
├── examples/
│   ├── cli-agent/                # Example CLI agent
│   └── cookbook/                 # Runnable learning path
├── packages/
│   ├── core/                     # @anvia/core
│   ├── embedding-*/              # Embedding adapters
│   ├── logger/                   # @anvia/logger
│   ├── observability-*/          # Observability adapters
│   ├── provider-*/               # Provider adapters
│   ├── react/                    # @anvia/react
│   ├── server/                   # @anvia/server
│   ├── tool-*/                   # Tool packages
│   └── vector-*/                 # Vector store adapters
└── bin/                          # Local maintenance scripts
```

The workspace is declared in `pnpm-workspace.yaml` and includes:

- `packages/*`
- `apps/*`
- `examples/*`

## Common Commands

Run these from the repository root:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm check:fix
pnpm format
```

Use package filters for faster iteration:

```sh
pnpm --filter @anvia/core typecheck
pnpm --filter @anvia/core test
pnpm --filter @anvia/core build

pnpm --filter @anvia/openai typecheck
pnpm --filter @anvia/openai test

pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build

pnpm --filter docs dev
pnpm --filter docs typecheck

pnpm --filter cookbook typecheck
```

## Environment Variables

Create a local `.env` file when running provider-backed examples:

```sh
OPENROUTER_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

Use `.env.example` as the public template. Never commit real secrets.

## Cookbook

The cookbook lives in `examples/cookbook` and is exposed through root scripts.

Run the first basic example:

```sh
pnpm cookbook:basics:01
```

Run the default example for each learning path:

```sh
pnpm cookbook:basics
pnpm cookbook:tools
pnpm cookbook:structured-output
pnpm cookbook:providers
pnpm cookbook:pipelines
pnpm cookbook:retrieval
pnpm cookbook:multi-agent
pnpm cookbook:evals
pnpm cookbook:studio
pnpm cookbook:integrations
```

Some retrieval examples need local services. Start ChromaDB before running Chroma-backed examples:

```sh
docker compose -f examples/cookbook/compose.cookbook.yml up -d
```

## Docs App

Run the docs app locally:

```sh
pnpm docs:dev
```

Validate docs:

```sh
pnpm docs:typecheck
pnpm docs:build
```

The docs typecheck command runs generators. If generated files change, inspect the diff and commit it only when the generated output is intentional.

## Package Development

Package manifests follow a consistent shape:

- Source files live under `src/`.
- Tests usually live under `test/`.
- Build output goes to `dist/`.
- Public package entry points are declared in `exports`.
- Build scripts use `tsup` for package output.
- Typechecking uses `tsc --noEmit`.
- Tests use `vitest run`.

When adding a public entry point:

1. Add the source file.
2. Add it to the package build command if needed.
3. Add it to `exports`.
4. Add tests or examples.
5. Run package-scoped build, typecheck, and tests.

## Dependency Maintenance

Run the upstream dependency report:

```sh
bin/check-upstream-deps.sh
```

Useful options:

```sh
bin/check-upstream-deps.sh --filter openai
bin/check-upstream-deps.sh --filter hono
bin/check-upstream-deps.sh --json
bin/check-upstream-deps.sh --fail-on-update
```

The script checks external runtime dependencies declared by packages under `packages/` and ignores local workspace dependencies.

When applying updates, use package-scoped pnpm commands:

```sh
pnpm --filter @anvia/openai add openai@^x.y.z
pnpm --filter @anvia/core add zod@^x.y.z
```

After dependency updates, run:

```sh
bin/check-upstream-deps.sh
pnpm typecheck
pnpm test
```

Keep related schema dependencies aligned across examples and packages. Multiple installed Zod minor versions can make TypeScript treat schemas as incompatible.

## Generated And Build Output

Do not edit `dist/` by hand. Generated files should be changed by their generator and reviewed like any other output.

If a command rewrites generated files unexpectedly, inspect the diff before committing it.

## Pre-Commit Checks

Husky is installed through the `prepare` script. Use the repository scripts directly when checking work manually:

```sh
pnpm check:staged
pnpm check
pnpm typecheck
pnpm test
```

## Troubleshooting

If workspace types look inconsistent after dependency changes:

```sh
pnpm install
pnpm typecheck
```

If pnpm installs multiple copies of a schema or SDK package, align the direct dependency ranges in every workspace that imports it.

If a package build passes but examples fail, check whether examples directly import the same dependency used by `@anvia/core` or a provider wrapper.
