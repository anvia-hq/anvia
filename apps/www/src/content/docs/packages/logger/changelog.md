---
title: "@anvia/logger: Changelog"
description: "Concise release notes and upgrade checks for @anvia/logger."
section: packages
sidebar:
  group: "@anvia/logger"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/logger@0.3.10`. The latest local changelog section is `0.3.10`.

## Latest local note

94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/logger/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/logger/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
