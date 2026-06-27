---
title: "@anvia/mistral: Changelog"
description: "Concise release notes and upgrade checks for @anvia/mistral."
section: packages
sidebar:
  group: "@anvia/mistral"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/mistral@0.3.1`. The latest local changelog section is `0.3.1`.

## Latest local note

0e33272: Update upstream runtime dependencies to their latest checked releases.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/provider-mistral/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/mistral/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
