---
"@anvia/react": minor
"@anvia/cli": patch
"@anvia/studio": patch
---

Merge headless React UI primitives from `@anvia/react-ui` into `@anvia/react` and remove the separate `@anvia/react-ui` package.

- `@anvia/react` now exports all headless UI primitives, providers, and subpaths (`./attachment`, `./chat`, `./completion`, `./graph-explorer`, `./human-input`, `./image`, `./message`, `./sandbox-terminal`, `./sandbox-desktop`, `./selection-toolbar`, `./stream`, `./shared`, `./thread-list`) alongside `useChat`, `useCompletion`, `useGraphExplorer`, and stream smoothing hooks, with `"sideEffects": false` so hooks-only imports tree-shake UI dependencies.
- `@anvia/cli` component registry templates and installer now target `@anvia/react`.
- `@anvia/studio` imports graph explorer and stream markdown primitives directly from `@anvia/react`.
