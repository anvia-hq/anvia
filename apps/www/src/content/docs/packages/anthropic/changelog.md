---
title: "@anvia/anthropic: Changelog"
description: "Concise release notes and upgrade checks for @anvia/anthropic."
section: packages
sidebar:
  group: "@anvia/anthropic"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/anthropic@0.3.11`. The latest local changelog section is `0.3.11`.

## Latest local note

0e33272: Update upstream runtime dependencies to their latest checked releases.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/provider-anthropic/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/anthropic/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
