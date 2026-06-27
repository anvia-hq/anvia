---
title: "@anvia/otel: Changelog"
description: "Concise release notes and upgrade checks for @anvia/otel."
section: packages
sidebar:
  group: "@anvia/otel"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/otel@0.2.11`. The latest local changelog section is `0.2.11`.

## Latest local note

f8b8538: Refactor package entrypoints into barrel exports with focused internal modules.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/observability-otel/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/otel/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
