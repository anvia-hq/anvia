# 0002: Enforce `anvia/no-inline-comments` in Oxlint

Status: Accepted.

## Context

Inline implementation comments (`// ...` and `/* ... */`) tend to drift from the code they describe,
compensate for unclear naming or oversized functions, and add noise during reviews. At the same
time, TypeScript/JavaScript source files legitimately need two categories of comments:

1. **Public and structural documentation** in JSDoc (`/** ... */`), which powers IDE hover docs,
   generated `.d.ts` files, and API references (for example, documenting exported types and their
   fields).
2. **Tooling and compiler directives** (`@ts-expect-error`, `/// <reference ... />`,
   `oxlint-disable-next-line`, `v8 ignore`, `@vitest-environment`, `@__PURE__`, etc.), which are
   consumed by compilers, linters, bundlers, and test runners.

Oxlint's built-in `eslint/no-inline-comments` only rejects comments placed on the _same line_ after
code (`const x = 1; // note`), leaving standalone `//` and non-JSDoc `/* ... */` comments unchecked.

## Decision

Add a custom Oxlint rule `anvia/no-inline-comments` in `tooling/oxlint/rules/no-inline-comments.mjs`
and enable it as `"error"` in `.oxlintrc.json`.

1. **Allowed comments.**
   - **Standalone JSDoc blocks** (`/** ... */`, where the comment body starts with `*` followed by
     whitespace or a newline, is non-empty, and does not trail a code token on the same line).
   - **Recognized tooling directives** matched by an explicit allowlist:
     - TypeScript: `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `@ts-check`, and triple-slash
       directives (`/// <reference ... />`, `/// <amd-module ... />`, `/// <amd-dependency ... />`).
     - Linters and formatters: `oxlint-*`, `eslint-*`, `eslint `, `global`/`globals`,
       `biome-ignore*`, `prettier-ignore`, `oxfmt-ignore`.
     - Coverage, bundlers, JSX, test runners, and license identifiers: `v8 ignore`, `c8 ignore`,
       `istanbul ignore`, `@__PURE__`/`#__PURE__`, `@__NO_SIDE_EFFECTS__`/`#__NO_SIDE_EFFECTS__`,
       `@vite-ignore`/`vite-ignore`, `webpack*` magic comments, `@jsx*`, `@vitest-environment`, and
       `SPDX-License-Identifier:`.
   - **Shebangs** (`#!...`), which are not `Line` or `Block` comments.
2. **Disallowed comments.**
   - All other `//` line comments (both standalone and trailing same-line).
   - All other `/* ... */` non-JSDoc block comments (including JSX `{/* ... */}`, decorative
     `/*** ... ***/` banners, and empty `/**/` blocks).
   - Trailing `/** ... */` comments on the same line after a code token.
3. **No autofix.**
   - Unlike `anvia/padded-if`, this rule intentionally provides no autofix. Silently stripping
     comments on `oxlint --fix` can erase useful rationale that should instead be expressed through
     clearer symbol names, helper extraction, JSDoc on exported contracts, or an ADR under
     `docs/decisions/`.
4. **Generated code exclusion.**
   - Generated Prisma client files under `tests/integration/memory-prisma/generated` are added to
     `.oxlintrc.json`'s `ignorePatterns` rather than hand-edited or exempted inline.
5. **Repo-wide enforcement.**
   - Existing violations across the repository are resolved up front rather than deferred behind
     per-file overrides, so every package, script, test, and cookbook file follows the same rule.

## Consequences

- Architectural rationale and non-obvious trade-offs live in `docs/decisions/` or exported JSDoc
  rather than scattered `//` comments inside function bodies.
- Arbitrary `@`-prefixed prose comments (such as `// @types/ws ...`) are rejected instead of being
  mistaken for directives.
- `tooling/oxlint/test/padded-if.test.mjs` explicitly disables `anvia/no-inline-comments` only in
  the unit tests that verify `padded-if` behavior around `//` comments.
