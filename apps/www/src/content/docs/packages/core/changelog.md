---
title: "@anvia/core: Changelog"
description: "Concise release notes and upgrade checks for @anvia/core."
section: packages
sidebar:
  group: "@anvia/core"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/core@0.8.0`. The latest local changelog section is `0.8.0`.

## Latest local note

3de3cce: Add an optional `update?` hook on `AgentGenerationObserver` so

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/core/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/core/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
