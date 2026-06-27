---
title: "@anvia/qdrant: Changelog"
description: "Concise release notes and upgrade checks for @anvia/qdrant."
section: packages
sidebar:
  group: "@anvia/qdrant"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/qdrant@0.2.10`. The latest local changelog section is `0.2.10`.

## Latest local note

94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/vector-qdrant/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/qdrant/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
