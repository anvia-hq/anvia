---
title: "@anvia/server: Changelog"
description: "Release history for @anvia/server."
section: packages
sidebar:
  group: "@anvia/server"
  order: 5
  label: "Changelog"
---

Release history mirrored from `packages/server/CHANGELOG.md`.

## 0.4.10

### Patch Changes

- Updated dependencies [6cd352e]
  - @anvia/core@0.12.3

## 0.4.9

### Patch Changes

- Updated dependencies [7b398eb]
  - @anvia/core@0.12.2

## 0.4.8

### Patch Changes

- Updated dependencies [2735197]
  - @anvia/core@0.12.1

## 0.4.7

### Patch Changes

- Updated dependencies [eed8b5f]
  - @anvia/core@0.12.0

## 0.4.6

### Patch Changes

- 264b92d: Restore React human-input hook state, harden overlapping chat sends, make fetch transports avoid implicit GET/HEAD bodies, and validate server-sent event control fields.

## 0.4.5

### Patch Changes

- Updated dependencies [32171dc]
  - @anvia/core@0.11.3

## 0.4.4

### Patch Changes

- Updated dependencies [730c23d]
  - @anvia/core@0.11.2

## 0.4.3

### Patch Changes

- Updated dependencies [9fc55c9]
  - @anvia/core@0.11.1

## 0.4.2

### Patch Changes

- Updated dependencies [4068a2a]
  - @anvia/core@0.11.0

## 0.4.1

### Patch Changes

- Updated dependencies [9e4de00]
  - @anvia/core@0.10.0

## 0.4.0

### Minor Changes

- ca25fca: Add the shared UI message stream protocol for React-facing completions and agents.

  `@anvia/core` now exposes `@anvia/core/ui` with UI message types, core/UI message conversion helpers, and adapters for completion and agent streams. `@anvia/server` adds `createUIStreamResponse`. `@anvia/react` now standardizes `useChat` and `useCompletion` around `UIMessage[]` state and the `{ messages, stream: true }` request shape.

### Patch Changes

- Updated dependencies [ca25fca]
  - @anvia/core@0.9.0

## 0.3.1

### Patch Changes

- b80f013: Refactor stream helpers into focused internal modules, add coverage-gated tests, and omit stack traces from default streamed server error events.

## 0.3.0

### Minor Changes

- e84d775: Clean up the `@anvia/core` public import surface by keeping common app-authoring APIs on the root export, moving advanced APIs to focused subpaths, and exposing runtime agent internals through `@anvia/core/internal/agent` for Anvia integration packages.

## 0.2.0

### Minor Changes

- eb90638: Add server stream response helpers and React client transports for JSONL and Server-Sent Event agent streams.
