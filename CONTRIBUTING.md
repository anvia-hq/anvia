# Contributing to Anvia

Thanks for taking the time to improve Anvia. This project is a TypeScript pnpm workspace for provider-agnostic AI runtime primitives, provider adapters, vector stores, observability integrations, Studio, docs, and runnable examples.

## Before You Start

- Read [README.md](README.md) for the product shape, package list, and cookbook path.
- Read [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, workspace commands, and release-adjacent maintenance notes.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in all project spaces.

## Contribution Scope

Good contributions usually fall into one of these areas:

- Core runtime fixes or focused feature work in `packages/core`.
- Provider adapter fixes in `packages/providers/*`.
- Vector store or embedding adapter fixes in `packages/vector-stores/*` and `packages/embeddings/*`.
- Studio runtime or UI fixes in `packages/tools/studio`.
- Cookbook examples that clarify an existing workflow or introduce a missing one.
- Documentation updates in `apps/docs` or package READMEs.
- Tests that capture bugs, edge cases, or public behavior.

Keep changes scoped. Avoid mixing dependency updates, formatting churn, generated output, and feature work unless they are needed for the same change.

## Workflow

1. Create a branch from the current main development branch.
2. Install dependencies with `pnpm install`.
3. Make the smallest coherent change.
4. Add or update tests for behavior changes.
5. Run the relevant package checks while developing.
6. Run workspace validation before opening a pull request.

```sh
pnpm typecheck
pnpm test
pnpm check
```

For package-scoped work, prefer filtered commands during iteration:

```sh
pnpm --filter @anvia/core typecheck
pnpm --filter @anvia/core test
pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter cookbook typecheck
```

## Pull Requests

Pull requests should include:

- A clear summary of what changed and why.
- The validation commands you ran.
- Any known limitations or follow-up work.
- Screenshots or short recordings for visible Studio or docs UI changes.
- Notes for breaking changes, migration needs, or dependency updates.

Before requesting review, make sure:

- `pnpm-lock.yaml` is updated only when dependencies changed.
- Generated files are either intentionally committed or left untouched.
- Public API changes include docs or cookbook examples when useful.
- New package exports are reflected in the package `exports` map.

## Code Style

- Use TypeScript and existing project patterns.
- Keep public APIs explicit and stable.
- Prefer typed schemas and runtime validation at tool and extraction boundaries.
- Keep provider-specific behavior inside provider packages.
- Keep `@anvia/core` free of optional provider SDK dependencies.
- Use Biome through the existing scripts rather than ad hoc formatting.
- Avoid unrelated refactors in bug-fix pull requests.

## Tests

Tests live beside the package they cover, usually under `test/`. Use focused tests for narrow fixes and broader coverage when changing shared runtime behavior.

Run all tests before larger changes:

```sh
pnpm test
```

Some cookbook examples require API keys or local services. Do not make ordinary unit tests depend on networked model providers.

## Dependency Updates

Anvia wraps several upstream SDKs and libraries. To check whether wrapped dependencies are current, run:

```sh
bin/check-upstream-deps.sh
```

Use filtered checks when updating a specific wrapper:

```sh
bin/check-upstream-deps.sh --filter openai
bin/check-upstream-deps.sh --filter hono
```

When updating dependencies:

- Prefer explicit package-scoped `pnpm --filter ... add package@^version` commands.
- Keep related peer dependencies aligned, especially `zod`.
- Run `pnpm typecheck`, `pnpm test`, and `bin/check-upstream-deps.sh` afterward.
- Call out major upstream updates in the pull request.

## Reporting Bugs

Bug reports should include:

- The package or example affected.
- A minimal reproduction or failing test case.
- Expected behavior and actual behavior.
- Node.js and pnpm versions.
- Relevant provider, model, or local service details.

Do not include API keys, secrets, private prompts, customer data, or credentials in issues, pull requests, logs, screenshots, or traces.

## Security

If you find a security issue, do not open a public issue with exploit details. Contact the maintainers privately with the smallest useful reproduction and impact description.

Security-sensitive areas include tool execution, file access, MCP integrations, provider credentials, tracing payloads, Studio approval flows, and any code that handles user-controlled input.
