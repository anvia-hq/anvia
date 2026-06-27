---
title: "@anvia/lancedb: Changelog"
description: "Concise release notes and upgrade checks for @anvia/lancedb."
section: packages
sidebar:
  group: "@anvia/lancedb"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/lancedb@0.2.3`. The latest local changelog section is `0.2.3`.

## Latest local note

2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/vector-lancedb/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/lancedb/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
