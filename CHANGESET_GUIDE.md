# Changeset Guide

Use Changesets whenever a change should publish one or more packages from `packages/` to npm.

## When To Add A Changeset

Add a changeset for any user-facing package change:

- `patch`: bug fixes, small behavior fixes, documentation fixes that affect the published package, or internal changes that should ship.
- `minor`: new backwards-compatible APIs, features, options, exports, or capabilities.
- `major`: breaking API, behavior, package export, runtime, or type changes.

Do not add a changeset for docs-only changes, CI changes, examples-only changes, or changes to private workspaces.

## Create A Changeset

From the repository root:

```sh
pnpm changeset
```

Then:

1. Select every package that should be released.
2. Choose the bump type for each selected package.
3. Write a short release note that explains the user-visible change.
4. Commit the generated file under `.changeset/` with your code changes.

Example changeset text:

```md
---
"@anvia/core": minor
"@anvia/openai": patch
---

Add streaming metadata support to core runs and align the OpenAI adapter output.
```

## Before Opening A PR

Run the relevant checks:

```sh
pnpm install --frozen-lockfile
pnpm --filter './packages/*' typecheck
pnpm --filter './packages/*' test
pnpm --filter './packages/*' build
```

If docs changed, also run:

```sh
pnpm --filter www reference-check
pnpm --filter www build
```

## Release Flow

After a PR with one or more changesets is merged into `main`, the GitHub Actions release workflow runs Changesets.

The workflow will:

1. Open or update a `Version Packages` release PR.
2. Apply version bumps to changed packages.
3. Update package changelogs.
4. Remove consumed `.changeset/*.md` files.

Review the release PR before merging it. Make sure package versions and changelog entries are correct.

## Publish To npm Manually

Merging the `Version Packages` release PR into `main` does not publish to npm. Publishing is manual dispatch only.

Publishing requires the repository secret:

```txt
NPM_TOKEN
```

To publish:

1. Merge the `Version Packages` release PR into `main`.
2. Open GitHub Actions.
3. Select the `Release Packages` workflow.
4. Click `Run workflow`.
5. Run it from the `main` branch.

The manual publish job builds packages before publishing:

```sh
pnpm release
```

That command runs:

```sh
pnpm --filter './packages/*' build && changeset publish
```

After packages publish successfully, the release workflow deploys the production docs. Docs do not deploy automatically on every push to `main`.

## Publish Preview Packages

Preview packages are early-access builds from `main`. They do not use Changesets, do not create GitHub Releases, do not deploy docs, and do not update the `latest` npm tag.

Create changesets with the feature or fix PR that changes package behavior. Do not add a changeset only because you want a preview build. Preview publishing does not consume `.changeset/*.md` files; those changesets remain available for the stable `Version Packages` PR.

To publish a preview:

1. Open GitHub Actions.
2. Select the `Publish Preview Packages` workflow.
3. Click `Run workflow`.
4. Run it from the `main` branch.

The workflow publishes every public package with a generated prerelease version:

```txt
0.7.2-preview.20260620T153000.abc1234
```

Users can install preview packages explicitly:

```sh
pnpm add @anvia/core@preview
```

## Manual Version Check

To preview what Changesets sees locally:

```sh
pnpm exec changeset status --since main
```

To apply version bumps locally for inspection only:

```sh
pnpm version-packages
```

Only commit local version bumps if you are intentionally preparing the release PR by hand. In normal development, let GitHub Actions create the release PR.
