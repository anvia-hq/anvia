---
title: "@anvia/milvus: Changelog"
description: "Concise release notes and upgrade checks for @anvia/milvus."
section: packages
sidebar:
  group: "@anvia/milvus"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/milvus@0.3.6`. The latest local changelog section is `0.3.6`.

## Latest local note

2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/vector-milvus/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/milvus/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
